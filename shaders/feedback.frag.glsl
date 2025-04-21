// File: shaders/feedback.frag.glsl
// Simulates video feedback (Corrected Alpha Handling + Final Edge Mask)

precision mediump float; // Using higher precision for better quality

varying vec2 vUv;

// Uniforms from JS
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
    // Use texture() which is preferred in modern GLSL
    vec4 currentFrameColor = texture(tDiffuse, uv);

    // --- Feedback Transformation ---
    // Calculate the UV coordinates to sample from the previous frame
    vec2 center = vec2(0.5, 0.5);
    vec2 transformedUv = uv;

    // 1. Scale - For tunnel effect
    float zoomBase = 1.00;
    float zoomAudio = audioLevel * 0.015;
    // float zoomPulse = sin(time * 0.2) * 0.003; // Keep commented if not needed
    float zoomPulse = 0.0;
    float zoom = zoomBase + zoomPulse + zoomAudio;
    transformedUv = (transformedUv - center) / zoom + center; // Apply zoom

    // 2. Rotation - For spiral effect (Keep commented if not needed)
    // float rotationSpeed = 0.05;
    // float rotationAudio = audioLevel * 0.1;
    // float rotationAngle = time * rotationSpeed + rotationAudio;
    float rotationAngle = 0.0;
    transformedUv = center + rotate2d(rotationAngle) * (transformedUv - center); // Apply rotation

    // 3. Translation - For subtle drift
    float driftAmount = 0.0005;
    transformedUv += vec2(
        sin(time * 0.1) * driftAmount,
        cos(time * 0.13) * driftAmount
    ); // Apply drift

    // --- Fetch Previous Frame ---
    // Sample the previous frame using the transformed UVs
    // Apply a smooth mask near the edges to prevent harsh cutoff
    vec4 previousFrameColor = vec4(0.0); // Default to black if outside bounds
    float edgeFadeWidth = 0.05;          // How wide the fade region is (0.0 to 1.0)

    // Calculate mask factor (1.0 in center, 0.0 at edge)
    float edgeMask = smoothstep(0.0, edgeFadeWidth, transformedUv.x) *
                     smoothstep(0.0, edgeFadeWidth, transformedUv.y) *
                     smoothstep(0.0, edgeFadeWidth, 1.0 - transformedUv.x) *
                     smoothstep(0.0, edgeFadeWidth, 1.0 - transformedUv.y);

    // Only sample if transformed UVs are within bounds (0.0 to 1.0)
    // The mask handles the fading, this check avoids potential issues, though clamp below might suffice
    if (transformedUv.x >= 0.0 && transformedUv.x <= 1.0 &&
        transformedUv.y >= 0.0 && transformedUv.y <= 1.0) {
        // Use texture() and provide bias if needed, but often not necessary here
        previousFrameColor = texture(prevFrame, transformedUv);
        // Apply edge mask to prevent sampling outside contributing to alpha/color weirdly
        // This was done later before, let's keep the original masked sample here
        previousFrameColor *= edgeMask;
    }
    // Note: `previousFrameColor` now contains the sampled color/alpha, already faded by the mask

    // --- Combine Current + Feedback (Corrected Alpha) ---

    // 1. Calculate combined RGB color using your additive method
    float currentFrameStrength = 0.2; // How much the current frame contributes
    vec3 feedbackColor = clamp(
        currentFrameColor.rgb * currentFrameStrength + // Use only .rgb
        previousFrameColor.rgb * feedbackAmount,       // Use only .rgb
        0.0, 1.0
    );

    // 2. Apply color shifting & boost to the RGB color
    float hueShift = sin(time * 0.1) * 0.05 + audioLevel * 0.1;
    feedbackColor.r *= 1.0 + hueShift;
    feedbackColor.b *= 1.0 - hueShift * 0.5;
    if (audioLevel > 0.6) {
        float boost = (audioLevel - 0.6) * 0.5;
        feedbackColor = clamp(feedbackColor * (1.0 + boost), 0.0, 1.0);
    }

    // 3. Calculate final Alpha separately
    float currentAlpha = currentFrameColor.a; // Alpha from current scene render
    float prevAlpha = previousFrameColor.a;   // Alpha from (masked) previous frame

    // Use max blend to preserve presence, apply feedbackAmount to fade trails
    float finalAlpha = max(currentAlpha, prevAlpha * feedbackAmount);

    // *** APPLY EDGE MASK AGAIN TO FINAL ALPHA ***
    // This forces alpha to 0 near edges, preventing edge artifacts
    // in the subsequent outline shader pass.
    finalAlpha *= edgeMask;
    // *** --- ***

    // --- Output ---
    // Combine the final calculated color and the final calculated/masked alpha
    gl_FragColor = vec4(feedbackColor, clamp(finalAlpha, 0.0, 1.0));
}