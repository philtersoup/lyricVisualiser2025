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
    
    vec2 distort(vec2 uv) {
        // Add stronger distortion for feedback warping
        uv.x += sin(uv.y * 8.0 + time) * 0.003 * feedbackAmount;
        uv.y += cos(uv.x * 8.0 + time) * 0.003 * feedbackAmount;
        return uv;
    }
    
    void main() {
        vec2 uv = vTexCoord;
        
        // Sample the current and previous frames
        vec4 current = texture2D(currentFrame, uv);
        vec4 prev = texture2D(prevFrame, distort(uv));
        
        // Mix the current frame with the previous frame - higher prev ratio for more trails
        vec4 color = mix(current, prev, 0.92 * feedbackAmount);
        
        // Add RGB shift to the feedback for more interesting trails
        color.r = mix(color.r, texture2D(prevFrame, distort(uv + vec2(0.003, 0.0))).r, 0.4 * feedbackAmount);
        color.b = mix(color.b, texture2D(prevFrame, distort(uv - vec2(0.003, 0.0))).b, 0.4 * feedbackAmount);
        
        gl_FragColor = color;
    }
`;