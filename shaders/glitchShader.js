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

    // Heavy UV drift distortion — ultra smeary
    vec2 meltDistort(vec2 uv, float t, float strength) {
        float wave1 = sin(uv.y * 10.0 + t * 1.5) * 0.02;
        float wave2 = cos(uv.x * 14.0 + t * 1.3) * 0.02;
        float swirl = sin(uv.x * 3.0 + uv.y * 4.0 + t * 0.7) * 0.015;

        uv.x += (wave1 + swirl) * strength;
        uv.y += (wave2 - swirl) * strength;
        return uv;
    }

    // Aggressive RGB drift with wobble and lag
    vec2 rgbDrift(vec2 uv, float amt, float timeOffset) {
        float shift = sin(uv.y * 10.0 + time * 0.8 + timeOffset) * amt;
        return uv + vec2(shift, 0.0);
    }

    void main() {
        vec2 uv = vTexCoord;

        // Intense melt distortion
        float meltStrength = 1.5 * (0.05 + intensity * 0.2 + audioLevel * 0.2);
        uv = meltDistort(uv, time, meltStrength);

        // Extreme RGB channel lag & smear
        float rgbAmt = 0.01 + intensity * 0.03 + audioLevel * 0.03;
        vec2 uvR = rgbDrift(uv, rgbAmt, 0.0);
        vec2 uvG = rgbDrift(uv, rgbAmt * 0.6, 1.0);
        vec2 uvB = rgbDrift(uv, rgbAmt * 0.8, 2.0);

        float r = texture2D(tex0, uvR).r;
        float g = texture2D(tex0, uvG).g;
        float b = texture2D(tex0, uvB).b;

        vec3 color = vec3(r, g, b);

        // Add melting chroma streaks
        float smear = sin(uv.x * 20.0 + time * 3.0) * sin(uv.y * 20.0 + time * 2.0);
        smear *= 0.2 * intensity;
        color.r += smear;
        color.g += smear * 0.5;
        color.b -= smear * 0.3;

        // Add soft pulsing ghost echoes
        vec2 echoUV = uv + vec2(0.02 * sin(time * 0.8), 0.02 * cos(time * 0.6));
        vec3 echo = texture2D(tex0, echoUV).rgb;
        color = mix(color, echo, 0.75 * intensity);

        // Smooth vignette to hold it together
        float vignette = smoothstep(0.8, 0.3, distance(uv, vec2(0.5)));
        color *= mix(1.0, vignette, 0.4 + 0.2 * audioLevel);

        gl_FragColor = vec4(color, 1.0);
    }
`;


