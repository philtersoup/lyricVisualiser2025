// Enhanced glitch shader for stronger video monitor effects
const glitchVertexShader = `
    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    
    varying vec2 vTexCoord;
    
    void main() {
        vTexCoord = aTexCoord;
        
        // Fix for p5.js WEBGL Y-axis flip
        vTexCoord.y = 1.0 - vTexCoord.y;
        
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
    
    // Improved random function with better distribution
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }
    
    // NEW: Create blocky digital noise
    float blockNoise(vec2 uv, float blockSize, float seed) {
        vec2 blockUV = floor(uv * blockSize) / blockSize;
        return random(blockUV * seed);
    }
    
    // NEW: Wave distortion for CRT effect
    vec2 crtDistortion(vec2 uv, float strength) {
        vec2 cc = uv - 0.5;
        float dist = dot(cc, cc) * strength;
        return uv + cc * (1.0 + dist) * dist;
    }
    
    // Enhanced RGB shifting
    vec2 rgbShift(vec2 uv, float direction, float amount) {
        // Use different patterns for each rgb shift
        float noise = random(vec2(time * 0.05, uv.y * 0.2)) * 2.0 - 1.0;
        
        // Add occasional larger jumps for "signal interference"
        if (random(vec2(time * 0.2, floor(uv.y * 10.0))) > 0.96) {
            noise *= 5.0;
        }
        
        return uv + vec2(noise * amount * direction, 0.0);
    }
    
    void main() {
        vec2 uv = vTexCoord;
        
        // CRT distortion - stronger when audio is louder
        float crtStrength = 0.3 + audioLevel * 0.3;
        uv = crtDistortion(uv, crtStrength);
        
        // Make sure we're within bounds after distortion
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
        }
        
        // RGB shift - much stronger than before
        float baseShiftAmount = intensity * (0.02 + audioLevel * 0.06);
        vec2 uvR = rgbShift(uv, 1.5, baseShiftAmount);
        vec2 uvG = uv; // Keep green channel centered
        vec2 uvB = rgbShift(uv, -1.5, baseShiftAmount);
        
        // Add horizontal tear/sync issues that occur randomly
        float tearThreshold = 0.97 - intensity * 0.1;
        float tearCheck = random(vec2(time * 2.0, floor(uv.y * 20.0)));
        float tearStrength = 0.1 * intensity;
        
        if (tearCheck > tearThreshold) {
            // Create horizontal tear/offset
            float offset = (random(vec2(time, uv.y)) * 2.0 - 1.0) * 0.1 * intensity;
            uvR.x += offset;
            uvG.x += offset * 0.8;
            uvB.x += offset * 1.2;
            
            // Add vertical jump to the tear
            float vertJump = (random(vec2(time * 0.5, uv.x)) * 2.0 - 1.0) * 0.05 * intensity;
            uvR.y += vertJump;
            uvG.y += vertJump;
            uvB.y += vertJump;
        }
        
        // Scan lines - enhanced pattern with audio-reactive intensity
        float scanLineCount = 100.0 + audioLevel * 50.0; // More lines during loud parts
        float scanLineWidth = 0.5; // Width of the dark part of the scan line (0-1)
        float scanLineIntensity = 0.15 * intensity + audioLevel * 0.1;
        float scanLine = step(scanLineWidth, fract(uv.y * scanLineCount + time * 3.0)); // Moving scanlines
        
        // VHS-like tracking errors that glitch vertically
        float trackingError = step(0.98 - intensity * 0.2, random(vec2(floor(time * 5.0), floor(uv.y * 2.0))));
        float trackingShift = random(vec2(time * 0.3, uv.y)) * 0.1 * intensity * trackingError;
        uvR.y += trackingShift;
        uvG.y += trackingShift * 0.9;
        uvB.y += trackingShift * 1.1;
        
        // Sample the texture with different UV coords for RGB channels
        float r = texture2D(tex0, uvR).r;
        float g = texture2D(tex0, uvG).g;
        float b = texture2D(tex0, uvB).b;
        
        // Digital noise - different types
        float staticNoise = random(uv * time) * intensity * 0.25;
        float blockNoise1 = blockNoise(uv, 50.0, time) * intensity * 0.2 * audioLevel;
        float blockNoise2 = blockNoise(uv + 0.1, 20.0, time * 1.5) * intensity * 0.15;
        
        // Apply noise to RGB channels with variation
        r += staticNoise * random(vec2(uv.x, time));
        g += blockNoise1 * random(vec2(uv.y, time * 1.1));
        b += blockNoise2 * random(vec2(uv.x + uv.y, time * 1.2));
        
        // Occasional full horizontal line glitches
        float lineGlitchThreshold = 0.98 - intensity * 0.05;
        if (random(vec2(floor(time * 10.0), floor(uv.y * 40.0))) > lineGlitchThreshold) {
            // Get random values for the glitched line
            float lineR = random(vec2(time * 0.1, uv.y));
            float lineG = random(vec2(time * 0.15, uv.y + 0.05));
            float lineB = random(vec2(time * 0.12, uv.y - 0.05));
            
            // Mix with the original color for a more natural effect
            r = mix(r, lineR, 0.7 * intensity);
            g = mix(g, lineG, 0.7 * intensity);
            b = mix(b, lineB, 0.7 * intensity);
        }
        
        // Create final color with scan lines
        vec3 color = vec3(r, g, b) * (scanLine * (1.0 - scanLineIntensity) + (1.0 - scanLineIntensity));
        
        // Add subtle vignette/CRT edge darkening
        float vignette = 1.0 - smoothstep(0.4, 0.75, length(uv - 0.5));
        color *= mix(1.0, vignette, 0.3 + audioLevel * 0.1);
        
        // Apply occasional CRT color tint shifts
        float tintShift = sin(time * 0.2) * 0.1 * intensity;
        color.r += tintShift;
        color.b -= tintShift * 0.7;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;