// File: shaders/glitch.frag.glsl

precision mediump float;

// Varying from vertex shader
varying vec2 vUv; // Use vUv

// Uniforms provided by ShaderPass / EffectComposer
uniform sampler2D tDiffuse; // Input texture (output of feedback pass)

// Custom uniforms you need to set via JavaScript
uniform float time;
uniform float intensity;
uniform float audioLevel;

// Hash function for noise generation
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// 2D value noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f); // Smoothstep
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// FBM (Fractal Brownian Motion) for more complex noise
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 2.0;
    for (int i = 0; i < 5; i++) { // Use a fixed loop count
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// Heavy UV drift distortion using noise
vec2 meltDistort(vec2 uv, float t, float strength) {
    float noise1 = fbm(vec2(uv.y * 5.0 + t * 0.7, uv.x * 3.0));
    float noise2 = fbm(vec2(uv.x * 4.0 - t * 0.5, uv.y * 6.0 + t * 0.3));
    float swirl = fbm(vec2(uv.x * 3.0 + uv.y * 4.0 + t * 0.4, uv.y * 2.0 - uv.x * 5.0 - t * 0.3)) * 0.03;
    vec2 distortion = vec2( noise1 * 0.04 + swirl, noise2 * 0.04 - swirl ) * strength;
    return uv + distortion;
}

// Aggressive RGB drift with wobble using noise
vec2 rgbDrift(vec2 uv, float amt, float timeOffset) {
    float shift = fbm(vec2(uv.y * 7.0 + time * 0.4 + timeOffset, time * 0.3 + timeOffset * 2.0)) * amt;
    return uv + vec2(shift, 0.0);
}

void main() {
    vec2 uv = vUv; // Use the varying

    // Intense melt distortion
    float meltStrength = 2.5 * (0.05 + intensity * 0.2 + audioLevel * 0.2);
    uv = meltDistort(uv, time, meltStrength);

    // Extreme RGB channel lag & smear
    float rgbAmt = 0.01 + intensity * 0.03 + audioLevel * 0.03;
    vec2 uvR = rgbDrift(uv, rgbAmt, 0.0);
    vec2 uvG = rgbDrift(uv, rgbAmt * 0.6, 1.0);
    vec2 uvB = rgbDrift(uv, rgbAmt * 0.8, 2.0);

    // Sample channels using distorted UVs
    // Use texture() instead of texture2D()
    float r = texture(tDiffuse, uvR).r;
    float g = texture(tDiffuse, uvG).g;
    float b = texture(tDiffuse, uvB).b;
    // Alpha usually comes from original uv
    float a = texture(tDiffuse, vUv).a; // Use original vUv for alpha maybe? Or distorted uv? Test this.

    vec3 color = vec3(r, g, b);

    // Add melting chroma streaks using noise
    float smear = fbm(vec2(uv.x * 10.0 + time * 1.5, uv.y * 10.0 - time)) * 2.0 - 1.0;
    smear *= 0.2 * intensity;
    color.r += smear;
    color.g += smear * 0.5;
    color.b -= smear * 0.3;

    // Add soft pulsing ghost echoes with noise-based displacement
    vec2 noiseOffset = vec2(
        fbm(vec2(time * 0.4, uv.y * 3.0)) * 0.04 - 0.02,
        fbm(vec2(uv.x * 3.0, time * 0.3)) * 0.04 - 0.02
    );
    vec2 echoUV = vUv + noiseOffset; // Use original vUv for echo source sampling? Or distorted uv? Test this.
    vec3 echo = texture(tDiffuse, echoUV).rgb;
    color = mix(color, echo, 0.95 * intensity); // Use clamp or smoothstep if intensity goes > 1

    // Noise-based vignette
    float vignetteNoise = noise(vec2(uv.x * 3.0 + time * 0.1, uv.y * 3.0 - time * 0.1)) * 0.1;
    float vignette = smoothstep(0.8 + vignetteNoise, 0.3 - vignetteNoise, distance(vUv, vec2(0.5))); // Use original vUv for distance
    color *= mix(1.0, vignette, 0.4 + 0.2 * audioLevel);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), a); // Clamp color, keep original alpha?
}