// File: shaders/feedback.vert.glsl
// Also save as: shaders/glitch.vert.glsl

varying vec2 vUv; // Use vUv convention for varying UVs

void main() {
  vUv = uv; // Pass the built-in uv attribute
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); // Standard Three.js projection
}