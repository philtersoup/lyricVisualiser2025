// Feedback shader for trail effects
const feedbackVertexShader = `
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

const feedbackFragmentShader = `
    precision mediump float;
    
    varying vec2 vTexCoord;
    
    uniform sampler2D prevFrame;
    uniform sampler2D currentFrame;
    uniform float feedbackAmount;
    uniform float time;
    uniform float audioLevel;

    // Organic flow distortion using UV turbulence
    vec2 meltDistort(vec2 uv, float t) {
        float flow = sin(t * 0.2) * 0.2 + 0.3;
        float noiseX = sin(uv.y * 10.0 + t * 0.5) * 0.01;
        float noiseY = cos(uv.x * 10.0 + t * 0.3) * 0.01;
        return uv + vec2(noiseX, noiseY) * flow;
    }

    void main() {
        vec2 uv = vTexCoord;

        // Apply soft swirling distortion
        vec2 distortedUV = meltDistort(uv, time);

        // Sample both frames
        vec4 current = texture2D(currentFrame, uv);
        vec4 prev = texture2D(prevFrame, distortedUV);

        // SUPER long trails: feedback blend almost fully previous
        float trailPersistence = mix(0.96, 0.995, feedbackAmount); // higher value = slower fade

        // Freezing effect: occasionally ignore current frame
        float freezeTrigger = step(0.997, fract(sin(time * 12.34) * 43758.5453));
        float freezeStrength = mix(1.0, 0.0, freezeTrigger); // freeze when trigger hits

        // Blend in current only if not freezing
        vec4 color = mix(current, prev, trailPersistence * freezeStrength);

        // Organic RGB drift
        vec2 shift = vec2(0.002, 0.0) * feedbackAmount;
        color.r = mix(color.r, texture2D(prevFrame, distortedUV + shift).r, 0.4 * feedbackAmount);
        color.b = mix(color.b, texture2D(prevFrame, distortedUV - shift).b, 0.4 * feedbackAmount);

        gl_FragColor = color;
    }
`;

