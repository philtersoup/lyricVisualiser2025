const glitchVertexShader = `
    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    
    varying vec2 vTexCoord;
    
    void main() {
        vTexCoord = aTexCoord;
        vTexCoord.y = 1.0 - vTexCoord.y; // Fix for p5.js WEBGL Y-axis flip
        
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
    }
`;

const glitchFragmentShader = `
    precision mediump float;

    varying vec2 vTexCoord;

    uniform sampler2D tex0;
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
        
        // Smoothstep for smoother interpolation
        vec2 u = f * f * (3.0 - 2.0 * f);
        
        // Mix 4 corners
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
        
        // Add multiple noise octaves
        for (int i = 0; i < 5; i++) {
            value += amplitude * noise(p * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
        }
        
        return value;
    }

    // Heavy UV drift distortion using noise
    vec2 meltDistort(vec2 uv, float t, float strength) {
        // Create organic distortion with layered noise
        float noise1 = fbm(vec2(uv.y * 5.0 + t * 0.7, uv.x * 3.0));
        float noise2 = fbm(vec2(uv.x * 4.0 - t * 0.5, uv.y * 6.0 + t * 0.3));
        
        // Add swirl effect
        float swirl = fbm(vec2(uv.x * 3.0 + uv.y * 4.0 + t * 0.4, uv.y * 2.0 - uv.x * 5.0 - t * 0.3)) * 0.03;
        
        // Apply distortion
        vec2 distortion = vec2(
            noise1 * 0.04 + swirl,
            noise2 * 0.04 - swirl
        ) * strength;
        
        return uv + distortion;
    }

    // Aggressive RGB drift with wobble using noise
    vec2 rgbDrift(vec2 uv, float amt, float timeOffset) {
        // Use noise for more organic drift
        float shift = fbm(vec2(uv.y * 7.0 + time * 0.4 + timeOffset, 
                              time * 0.3 + timeOffset * 2.0)) * amt;
        
        return uv + vec2(shift, 0.0);
    }

    void main() {
    vec2 uv = vTexCoord;

    // Reduce melt strength for better visibility
    float meltStrength = 1.5 * (0.05 + intensity * 0.2 + audioLevel * 0.2);
    uv = meltDistort(uv, time, meltStrength);

    // Reduce RGB channel separation
    float rgbAmt = 0.007 + intensity * 0.02 + audioLevel * 0.02;
    vec2 uvR = rgbDrift(uv, rgbAmt, 0.0);
    vec2 uvG = rgbDrift(uv, rgbAmt * 0.5, 1.0);
    vec2 uvB = rgbDrift(uv, rgbAmt * 0.7, 2.0);

    float r = texture2D(tex0, uvR).r;
    float g = texture2D(tex0, uvG).g;
    float b = texture2D(tex0, uvB).b;
    float a = texture2D(tex0, uv).a;

    vec3 color = vec3(r, g, b);

    // Reduce smear effect
    float smear = fbm(vec2(uv.x * 10.0 + time * 1.5, uv.y * 10.0 - time)) * 2.0 - 1.0;
    smear *= 0.1 * intensity; // Reduced from 0.2
    color.r += smear;
    color.g += smear * 0.5;
    color.b -= smear * 0.3;

    // Brighten the output
    color = color * 1.3; // Boost brightness
    
    // Lighter vignette
    float vignetteNoise = noise(vec2(uv.x * 3.0 + time * 0.1, uv.y * 3.0 - time * 0.1)) * 0.1;
    float vignette = smoothstep(0.9 + vignetteNoise, 0.4 - vignetteNoise, distance(uv, vec2(0.5)));
    color *= mix(1.0, vignette, 0.2 + 0.1 * audioLevel); // Reduced vignette effect

    gl_FragColor = vec4(color, 1.0);
}
`;