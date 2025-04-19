// File: shaders/feedback.frag.glsl
// Simulates video feedback (camera pointed at screen)

precision highp float; // Using higher precision for better quality

varying vec2 vUv;

uniform sampler2D tDiffuse; // Current frame's render (lyrics, etc.)
uniform sampler2D prevFrame; // Previous frame's feedback output

uniform float feedbackAmount; // Controls trail intensity (0.9-0.99)
uniform float time;
uniform float audioLevel;

// Simple 2D rotation function
mat2 rotate2d(float angle) {
    return mat2(cos(angle), -sin(angle),
                sin(angle), cos(angle));
}

void main() {
    vec2 uv = vUv;
    
    // Get current frame color (the freshly rendered scene)
    vec4 currentFrameColor = texture(tDiffuse, uv);
    
    // --- Feedback Transformation ---
    vec2 center = vec2(0.5, 0.5);
    vec2 transformedUv = uv;
    
    // 1. Scale - Most important for tunnel effect
    // Use a value > 1.0 for zoom-in tunnel effect
    // Making the scaling stronger for more pronounced tunneling
    float zoomBase = 1.00;  // Base zoom factor (increased)
    float zoomAudio = audioLevel * 0.01; // Audio-reactive component
    //float zoomPulse = sin(time * 0.2) * 0.003; // Subtle pulsing
    float zoomPulse = 0.0;
    float zoom = zoomBase + zoomPulse + zoomAudio;
    
    // Apply zoom - this is the key to the tunnel effect
    transformedUv = (transformedUv - center) / zoom + center;
    
    // 2. Rotation - Creates spiral effect
    float rotationSpeed = 0.05; // Base rotation speed
    float rotationAudio = audioLevel * 0.1; // Audio-reactive component
    //float rotationAngle = time * rotationSpeed + rotationAudio;
    float rotationAngle = 0.0;
    transformedUv = center + rotate2d(rotationAngle) * (transformedUv - center);
    
    // 3. Translation - Subtle drift
    float driftAmount = 0.0005; // Small drift amount
    transformedUv += vec2(
        sin(time * 0.1) * driftAmount,
        cos(time * 0.13) * driftAmount
    );
    
    // --- Fetch Previous Frame ---
    // Check boundaries with smooth edge fade
    vec4 previousFrameColor = vec4(0.0);
    float edgeFadeWidth = 0.05;
    float edgeMask = smoothstep(0.0, edgeFadeWidth, transformedUv.x) * 
                     smoothstep(0.0, edgeFadeWidth, transformedUv.y) *
                     smoothstep(0.0, edgeFadeWidth, 1.0 - transformedUv.x) *
                     smoothstep(0.0, edgeFadeWidth, 1.0 - transformedUv.y);
    
    if (transformedUv.x >= 0.0 && transformedUv.x <= 1.0 && 
        transformedUv.y >= 0.0 && transformedUv.y <= 1.0) {
        previousFrameColor = texture(prevFrame, transformedUv);
        previousFrameColor *= edgeMask; // Apply smooth edges
    }
    
    // --- Combine Current + Feedback ---
    // Method 1: Additive blending with current frame attenuation
    // This creates brighter, more analog-looking feedback
    float currentFrameStrength = 0.2; // Reduce current frame contribution
    vec4 feedbackResult = clamp(
        currentFrameColor * currentFrameStrength + 
        previousFrameColor * feedbackAmount,
        0.0, 1.0
    );
    
    // Apply subtle color shifting for a more psychedelic effect
    float hueShift = sin(time * 0.1) * 0.05 + audioLevel * 0.1;
    feedbackResult.r *= 1.0 + hueShift;
    feedbackResult.b *= 1.0 - hueShift * 0.5;
    
    // Boost brightness where audio is strong
    if (audioLevel > 0.6) {
        float boost = (audioLevel - 0.6) * 0.5;
        feedbackResult = clamp(feedbackResult * (1.0 + boost), 0.0, 1.0);
    }
    
    gl_FragColor = feedbackResult;
}