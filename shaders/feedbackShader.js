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

    // Simple checkerboard without any fancy effects
    // This isolates the checkerboard pattern to see if that's working
    vec4 simpleCheckerboard(vec2 uv) {
        float checkerSize = 30.0; // Very large checkers
        vec2 checkPos = floor(uv * checkerSize);
        float checker = mod(checkPos.x + checkPos.y, 2.0);
        
        // Pure black and white
        vec3 color = vec3(checker);
        return vec4(color, 1.0);
    }

    void main() {
        vec2 uv = vTexCoord;
        
        // Basic feedback mix
        vec4 current = texture2D(currentFrame, uv);
        vec4 prev = texture2D(prevFrame, uv); // No distortion for diagnostic

        // Mix the current frame and previous frame
        float fadeSpeed = 0.9; // High value = longer trails
        vec4 feedbackMix = mix(current, prev, fadeSpeed);
        
        // Get the checkerboard pattern
        vec4 checker = simpleCheckerboard(uv);
        
        // For diagnostics, let's clearly see where different parts affect the output
        // based on screen position
        if (uv.x < 0.33) {
            // Left third: just show checkerboard
            gl_FragColor = checker;
        } 
        else if (uv.x < 0.66) {
            // Middle third: mix checkerboard with current frame 
            gl_FragColor = mix(checker, current, 0.5);
        }
        else {
            // Right third: normal feedback with a bit of checkerboard
            gl_FragColor = mix(feedbackMix, checker, 0.3);
        }
    }
`;