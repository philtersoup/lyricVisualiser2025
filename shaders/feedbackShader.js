// Fix flipping in the vertex shader
const feedbackVertexShader = `
    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    
    varying vec2 vTexCoord;
    
    void main() {
        vTexCoord = aTexCoord;
        
        // Remove the Y-axis flip that was causing orientation issues
        // vTexCoord.y = 1.0 - vTexCoord.y; <- Remove this line
        
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
    }
`;

// Update in feedbackShader.js
// Improved feedback shader with better visibility
const feedbackFragmentShader = `
    precision mediump float;
    
    varying vec2 vTexCoord;
    
    uniform sampler2D prevFrame;
    uniform sampler2D currentFrame;
    uniform float feedbackAmount;
    uniform float time;
    uniform float audioLevel;

    void main() {
        vec2 uv = vTexCoord;
        
        // Sample current frame
        vec4 current = texture2D(currentFrame, uv);
        
        // Sample previous frame with minimal distortion
        vec2 distortedUV = uv + vec2(
            sin(uv.y * 10.0 + time) * 0.001,
            cos(uv.x * 10.0 + time) * 0.001
        );
        vec4 prev = texture2D(prevFrame, distortedUV);
        
        // Use much lower feedback amount to prevent darkness buildup
        // 0.6-0.85 range will keep things visible while still showing trails
        float fade = clamp(feedbackAmount * 0.8, 0.6, 0.85);
        
        // Significant brightness boost for the feedback
        prev.rgb *= 1.3;
        
        // Mix with priority on keeping current frame visible
        vec4 result = mix(current, prev, fade);
        
        // Additional brightness boost
        result.rgb *= 1.5;
        
        // Output the final color
        gl_FragColor = result;
    }
`;