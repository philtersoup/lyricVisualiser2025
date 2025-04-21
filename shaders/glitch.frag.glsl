// --- /shaders/glitch.frag.glsl (Combined Glitch + Hardcoded Outline Test + Border Fix) ---

precision mediump float;

// Varying from vertex shader
varying vec2 vUv;

// Uniforms provided by ShaderPass / EffectComposer (Keep these)
uniform sampler2D tDiffuse; // Input texture (output of feedback pass)
uniform float time;
uniform float intensity;
uniform float audioLevel;

// --- Helper Functions from Your Glitch Shader ---
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

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

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 2.0;
    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

vec2 meltDistort(vec2 uv, float t, float strength) {
    float noise1 = fbm(vec2(uv.y * 5.0 + t * 0.7, uv.x * 3.0));
    float noise2 = fbm(vec2(uv.x * 4.0 - t * 0.5, uv.y * 6.0 + t * 0.3));
    float swirl = fbm(vec2(uv.x * 3.0 + uv.y * 4.0 + t * 0.4, uv.y * 2.0 - uv.x * 5.0 - t * 0.3)) * 0.03;
    vec2 distortion = vec2( noise1 * 0.04 + swirl, noise2 * 0.04 - swirl ) * strength;
    return uv + distortion;
}

vec2 rgbDrift(vec2 uv, float amt, float timeOffset) {
    float shift = fbm(vec2(uv.y * 7.0 + time * 0.4 + timeOffset, time * 0.3 + timeOffset * 2.0)) * amt;
    return uv + vec2(shift, 0.0);
}
// --- End Helper Functions ---


// --- Hardcoded Outline Helper Function ---
bool isOutlineHardcoded(sampler2D tex, vec2 uv) {
    // Hardcoded Parameters
    float thickness = 0.0015; // Approx thickness in UV space
    float threshold = 0.5;    // Alpha threshold
    float borderMargin = 0.01; // Ignore outline near edge

    // Border Check
    if (uv.x < borderMargin || uv.x > 1.0 - borderMargin || uv.y < borderMargin || uv.y > 1.0 - borderMargin) {
        return false;
    }

    // Center Pixel Check
    vec4 centerPixel = texture(tex, uv);
    if (centerPixel.a >= threshold) {
        return false; // Foreground
    }

    // Neighbor Check
    vec2 step = vec2(thickness);
    float neighborAlpha = 0.0;
    neighborAlpha = max(neighborAlpha, texture(tex, clamp(uv + vec2(0.0, step.y), 0.0, 1.0)).a); // Up
    neighborAlpha = max(neighborAlpha, texture(tex, clamp(uv - vec2(0.0, step.y), 0.0, 1.0)).a); // Down
    neighborAlpha = max(neighborAlpha, texture(tex, clamp(uv + vec2(step.x, 0.0), 0.0, 1.0)).a); // Right
    neighborAlpha = max(neighborAlpha, texture(tex, clamp(uv - vec2(step.x, 0.0), 0.0, 1.0)).a); // Left

    return neighborAlpha >= threshold; // Is outline if background + foreground neighbor
}
// --- End Outline Helper Function ---


void main() {
    // --- 1. Your Original Glitch Logic ---
    vec2 uv = vUv;
    float meltStrength = 2.5 * (0.05 + intensity * 0.2 + audioLevel * 0.2);
    vec2 distortedUv = meltDistort(uv, time, meltStrength);
    float rgbAmt = 0.01 + intensity * 0.03 + audioLevel * 0.03;
    vec2 uvR = rgbDrift(distortedUv, rgbAmt, 0.0);
    vec2 uvG = rgbDrift(distortedUv, rgbAmt * 0.6, 1.0);
    vec2 uvB = rgbDrift(distortedUv, rgbAmt * 0.8, 2.0);
    float r = texture(tDiffuse, uvR).r;
    float g = texture(tDiffuse, uvG).g;
    float b = texture(tDiffuse, uvB).b;
    float a = texture(tDiffuse, vUv).a;
    vec3 color = vec3(r, g, b);
    float smear = fbm(vec2(distortedUv.x * 10.0 + time * 1.5, distortedUv.y * 10.0 - time)) * 2.0 - 1.0;
    smear *= 0.2 * intensity;
    color.r += smear;
    color.g += smear * 0.5;
    color.b -= smear * 0.3;
    vec2 noiseOffset = vec2(
        fbm(vec2(time * 0.4, vUv.y * 3.0)) * 0.04 - 0.02,
        fbm(vec2(vUv.x * 3.0, time * 0.3)) * 0.04 - 0.02
    );
    vec2 echoUV = vUv + noiseOffset;
    vec3 echo = texture(tDiffuse, echoUV).rgb;
    color = mix(color, echo, clamp(0.95 * intensity, 0.0, 1.0));
    float vignetteNoise = noise(vec2(vUv.x * 3.0 + time * 0.1, vUv.y * 3.0 - time * 0.1)) * 0.1;
    float vignette = smoothstep(0.8 + vignetteNoise, 0.3 - vignetteNoise, distance(vUv, vec2(0.5)));
    color *= mix(1.0, vignette, 0.4 + 0.2 * audioLevel);
    vec4 finalGlitchedColor = vec4(clamp(color, 0.0, 1.0), a);
    // --- End Your Original Glitch Logic ---


    // --- 2. Outline Logic (Final Step) ---
    // Check neighbors on the *original*, non-distorted input texture
    if (isOutlineHardcoded(tDiffuse, vUv)) {
        // Draw hardcoded outline color if needed
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Hardcoded Black Outline
    } else {
        // Otherwise, output the final calculated glitched color
        gl_FragColor = finalGlitchedColor;
    }
}