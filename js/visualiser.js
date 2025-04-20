import * as THREE from 'three';
// Import OrbitControls for basic camera interaction during development (optional)
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// Import post-processing modules
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- Global Variables ---

// Core Three.js
let scene, camera, renderer;
// let controls; // For OrbitControls (optional)

// Post-Processing
let composer;
let renderTargetA, renderTargetB; // For ping-pong feedback
let feedbackShader, glitchShader; // Shader materials
let quadScene, quadCamera; // For rendering full-screen quads
let feedbackQuad, outputQuad; // Full-screen quads for effects

// Audio
let listener, sound, audioLoader, analyser;
const FFT_SIZE = 1024;

// Lyrics
let lyrics = [];
let srtLoaded = false;
// let currentLyric = null; // Not currently used

// Animation / Timing
const clock = new THREE.Clock();
// Custom audio playback tracking
let audioStartTimestamp = 0;
let audioPaused = true;
let audioOffset = 0;
// let lastPauseTime = 0; // Not strictly needed with current manual timer

// Mouse/Touch Interaction
let mouseX = 0;
let mouseY = 0;
let targetMouseX = 0;
let targetMouseY = 0;
let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;
let isInteracting = false;
let touchStartX = 0;
let touchStartY = 0;
let cameraStartX = 0;
let cameraStartY = 0;
let cameraStartZ = 0;

const raycaster = new THREE.Raycaster();
const mouse3D = new THREE.Vector2(); // Normalized mouse position (-1 to 1)
const mousePlaneZ = -100; // Z-plane where mouse interaction occurs
const mouseWorldPosition = new THREE.Vector3(); // 3D position in world space

let viewportWorldWidth = 0;
let viewportWorldHeight = 0;
let aspectRatio = 1;

// --- Shader Paths (ADJUST THESE TO YOUR ACTUAL FILES) ---
const FEEDBACK_VERTEX_PATH = '/shaders/feedback.vert.glsl';
const FEEDBACK_FRAGMENT_PATH = '/shaders/feedback.frag.glsl';
const GLITCH_VERTEX_PATH = '/shaders/glitch.vert.glsl';
const GLITCH_FRAGMENT_PATH = '/shaders/glitch.frag.glsl';

// --- Constants ---
const FONT_SIZE = 50;
// Replaced static font face with variable that will be updated after loading
let FONT_FACE = 'sans-serif'; // Default fallback
const FONT_FILE_PATH = 'Blackout Midnight.ttf'; // Path to your font file
const FONT_FAMILY_NAME = 'Blackout Midnight'; // Name to reference the font with
const LETTER_COLOR = '#FFFFFF';
const LETTER_SPACING_FACTOR = 0.1;

// Flag to track font loading status
let customFontLoaded = false;

function updateMouse3DPosition(event) {
    // Update the 2D normalized mouse coordinates
    mouse3D.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse3D.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // Cast a ray from the camera through the mouse position
    raycaster.setFromCamera(mouse3D, camera);
    
    // Calculate the point on the Z plane
    const planeNormal = new THREE.Vector3(0, 0, 1);
    const planeConstant = -mousePlaneZ; // Plane equation: ax + by + cz + d = 0, where d = -planeZ
    const plane = new THREE.Plane(planeNormal, planeConstant);
    
    // Find intersection of ray with the plane
    raycaster.ray.intersectPlane(plane, mouseWorldPosition);
}

// Function to calculate viewport dimensions in world space at a given Z-depth
function updateViewportDimensions() {
    // Get the current camera properties
    if (!camera) return; // Safety check in case camera is not initialized yet
    
    const fov = camera.fov * (Math.PI / 180); // Convert to radians
    const zDepth = -150; // A reference Z-depth where lyrics typically appear
    
    // Calculate viewport height at the target Z depth (using tan(fov/2) formula)
    // For perspective camera: height = 2 * tan(fov/2) * distance
    const distance = Math.abs(zDepth - camera.position.z);
    viewportWorldHeight = 2 * Math.tan(fov / 2) * distance;
    
    // Calculate width using aspect ratio
    aspectRatio = window.innerWidth / window.innerHeight;
    viewportWorldWidth = viewportWorldHeight * aspectRatio;
    
    console.log(`Viewport at Z=${zDepth}: ${viewportWorldWidth.toFixed(2)} x ${viewportWorldHeight.toFixed(2)}`);
  }
  
  // Convert percentages (-1 to 1 range) to actual world coordinates
  function getWorldPositionFromPercent(xPercent, yPercent, zDepth) {
    // Convert -1 to 1 range to actual world coordinates based on viewport size
    const worldX = (xPercent * viewportWorldWidth) / 2;
    const worldY = (yPercent * viewportWorldHeight) / 2;
    
    return { x: worldX, y: worldY, z: zDepth };
  }
  
  // Generate a random position within specified percentage ranges of the viewport
  function randomPositionInViewport(
    xMinPercent = -0.3, xMaxPercent = 0.3,
    yMinPercent = -0.3, yMaxPercent = 0.3,
    zMinDepth = -250, zMaxDepth = -50
  ) {
    const xPercent = THREE.MathUtils.randFloat(xMinPercent, xMaxPercent);
    const yPercent = THREE.MathUtils.randFloat(yMinPercent, yMaxPercent);
    const zDepth = THREE.MathUtils.randFloat(zMinDepth, zMaxDepth);
    
    const pos = getWorldPositionFromPercent(xPercent, yPercent, zDepth);
    return pos;
  }
// --- Add Mouse/Touch Interaction Setup ---
function setupInteraction() {
    // Mouse events
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('mouseup', onDocumentMouseUp);
    
    // Touch events
    document.addEventListener('touchstart', onDocumentTouchStart, { passive: false });
    document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', onDocumentTouchEnd);
    
    console.log("Mouse/touch interaction setup complete");
}

function onDocumentMouseMove(event) {
    // Original mouse tracking code
    mouseX = (event.clientX - windowHalfX) / 50;
    mouseY = (event.clientY - windowHalfY) / 50;
    
    // Add new 3D position tracking
    updateMouse3DPosition(event);
    
    // Existing interaction logic
    if (isInteracting) {
        targetMouseX = mouseX;
        targetMouseY = mouseY;
    }
}

function onDocumentMouseDown(event) {
    isInteracting = true;
    // Store initial camera position
    cameraStartX = camera.position.x;
    cameraStartY = camera.position.y;
    cameraStartZ = camera.position.z;
    // Store initial mouse position
    touchStartX = event.clientX;
    touchStartY = event.clientY;
}

function onDocumentMouseUp() {
    isInteracting = false;
}

function onDocumentTouchStart(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        isInteracting = true;
        
        // Store initial touch position
        touchStartX = event.touches[0].pageX;
        touchStartY = event.touches[0].pageY;
        
        // Store initial camera position
        cameraStartX = camera.position.x;
        cameraStartY = camera.position.y;
        cameraStartZ = camera.position.z;
    }
}

function onDocumentTouchMove(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        
        const touchX = event.touches[0].pageX;
        const touchY = event.touches[0].pageY;
        
        mouseX = (touchX - touchStartX) / 20;
        mouseY = (touchY - touchStartY) / 20;
        
        // Add touch position to 3D tracking (simulate mouse event)
        updateMouse3DPosition({
            clientX: touchX,
            clientY: touchY
        });
        
        if (isInteracting) {
            targetMouseX = mouseX;
            targetMouseY = mouseY;
        }
    }
}

function onDocumentTouchEnd() {
    isInteracting = false;
}

// --- Font Loading Function ---
async function loadCustomFont() {
    try {
        console.log(`Loading custom font from: ${FONT_FILE_PATH}`);
        
        // Encode the URL to handle spaces and special characters
        const encodedFontPath = encodeURIComponent(FONT_FILE_PATH);
        
        // Create a new FontFace object with explicit format and proper URL encoding
        const fontFace = new FontFace(
            FONT_FAMILY_NAME, 
            `url('${encodedFontPath}') format('truetype')`
        );
        
        // Wait for the font to load
        const loadedFont = await fontFace.load();
        
        // Add the loaded font to the document fonts
        document.fonts.add(loadedFont);
        
        // Update the global font face variable
        FONT_FACE = FONT_FAMILY_NAME;
        customFontLoaded = true;
        
        console.log(`Custom font "${FONT_FAMILY_NAME}" loaded successfully`);
        return true;
    } catch (error) {
        console.error('Error loading custom font:', error);
        console.log('Falling back to default font');
        return false;
    }
}

// --- Shader Loading ---
async function loadShader(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return await response.text();
    } catch (e) {
        console.error(`Failed to load shader: ${url}`, e);
        // Return a basic default shader string on error to prevent crashes
        if (url.includes('.vert')) {
            return `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
        } else {
            return `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`;
        }
    }
}

async function loadShaders() {
    console.log("Loading shaders...");
    const [feedbackVS, feedbackFS, glitchVS, glitchFS] = await Promise.all([
        loadShader(FEEDBACK_VERTEX_PATH),
        loadShader(FEEDBACK_FRAGMENT_PATH),
        loadShader(GLITCH_VERTEX_PATH),
        loadShader(GLITCH_FRAGMENT_PATH)
    ]);
    console.log("Shaders loaded.");
    return { feedbackVS, feedbackFS, glitchVS, glitchFS };
}
// Audio Setup with iOS compatibility
function setupAudio() {
    listener = new THREE.AudioListener();
    camera.add(listener);
    sound = new THREE.Audio(listener);
    audioLoader = new THREE.AudioLoader();
    
    // Create an audio analyzer after loading the buffer
    const setupAnalyzer = (buffer) => {
        // Set buffer to the sound
        sound.setBuffer(buffer);
        
        // Lower initial volume and set loop if needed
        sound.setVolume(0.5);
        // sound.setLoop(true); // Uncomment if you want looping
        
        // Create analyzer
        analyser = new THREE.AudioAnalyser(sound, FFT_SIZE);
        console.log("Audio loaded and analyzer created");
    };
    
    return new Promise((resolve, reject) => {
        audioLoader.load('Vessels_Masterv3_4824.mp3', 
            // Success callback
            buffer => {
                setupAnalyzer(buffer);
                resolve(buffer);
            },
            // Progress callback
            progress => {
                console.log(`Audio loading: ${Math.round(progress.loaded / progress.total * 100)}%`);
            },
            // Error callback
            error => {
                console.error('Error loading audio:', error);
                reject(error);
            }
        );
    });
}

// --- Initialization ---
async function init() {
    console.log("init() called");
    
    // Scene
    scene = new THREE.Scene();

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 25, 2000);
    camera.position.set(0, 0, 250);
    camera.lookAt(scene.position);
    
    // Calculate viewport dimensions in world space
    updateViewportDimensions();
    
    // Update window half values for mouse interaction
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    await setupAudio();
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        preserveDrawingBuffer: true // Important for feedback!
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; // Very important for feedback effect
    document.getElementById('visualizer-container').appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(0.5, 0.5, -1);
    scene.add(directionalLight);

    // Setup mouse/touch interaction
    setupInteraction();
    
    // Load custom font first
    try {
        await loadCustomFont();
    } catch (error) {
        console.error("Custom font loading failed, using fallback:", error);
    }

    // --- Load Assets Concurrently (Audio, SRT, Shaders) ---
    console.log("Starting asset loading...");
    const [shaders, audioBufferResult, srtResult] = await Promise.allSettled([
        loadShaders(),
        new Promise((resolve, reject) => {
            audioLoader.load('Vessels_Masterv3_4824.mp3', buffer => resolve(buffer), undefined, err => reject(err));
        }),
        fetch('lyrics.srt').then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.text();
        })
    ]);

    // Check Shader loading results
    if (shaders.status !== 'fulfilled') {
        console.error("Failed to load shaders!", shaders.reason);
        return;
    }
    const shaderCode = shaders.value;

    // Process Audio loading results
    if (audioBufferResult.status === 'fulfilled') {
        sound.setBuffer(audioBufferResult.value);
        sound.setVolume(0.5);
        console.log("Audio loaded successfully.");
    } else {
        console.error('Error loading audio:', audioBufferResult.reason);
    }

    // Process SRT loading results
    if (srtResult.status === 'fulfilled') {
        lyrics = parseSRT(srtResult.value);
        srtLoaded = true;
        console.log("SRT parsed, found " + lyrics.length + " entries");
        if (lyrics.length > 0) {
            createLyricObjects();
        }
    } else {
        console.error("Error loading SRT:", srtResult.reason);
    }
    console.log("Asset loading finished.");

    // --- Setup Post-Processing using our new function ---
    await setupPostProcessing(shaderCode);

    // Setup Controls
    setupControls();

    // Add Resize Listener
    window.addEventListener('resize', onWindowResize);

    // Start Animation Loop
    console.log("Starting animation loop...");
    animate();
}

// --- Post-Processing Setup (Replace your existing setup) ---
async function setupPostProcessing(shaderCode) {
    console.log("Setting up ping-pong feedback post-processing...");
    
    // Create two separate render targets
    const targetOptions = { 
        minFilter: THREE.LinearFilter, 
        magFilter: THREE.LinearFilter, 
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        stencilBuffer: false
    };
    
    const pixelRatio = renderer.getPixelRatio();
    const width = window.innerWidth * pixelRatio;
    const height = window.innerHeight * pixelRatio;
    
    renderTargetA = new THREE.WebGLRenderTarget(width, height, targetOptions);
    renderTargetB = new THREE.WebGLRenderTarget(width, height, targetOptions);
    
    // Create an orthographic camera for rendering full-screen quads
    quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadScene = new THREE.Scene();
    
    // Create the feedback shader material 
    feedbackShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },    // Current frame (scene)
            prevFrame: { value: null },   // Previous feedback result
            feedbackAmount: { value: 0.95 },
            time: { value: 0.0 },
            audioLevel: { value: 0.0 }
        },
        vertexShader: shaderCode.feedbackVS,
        fragmentShader: shaderCode.feedbackFS
    });
    
    // Create the glitch shader material
    glitchShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },    // Input texture
            intensity: { value: 0.3 },
            time: { value: 0.0 },
            audioLevel: { value: 0.0 }
        },
        vertexShader: shaderCode.glitchVS,
        fragmentShader: shaderCode.glitchFS
    });
    
    // Create a full-screen quad for the feedback effect
    feedbackQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        feedbackShader
    );
    
    // Create a full-screen quad for the final output with glitch effect
    outputQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        glitchShader
    );
    
    console.log("Post-processing setup complete.");
}



// --- Loaders (loadAudio handled in init) ---

// --- SRT Parsing (Your functions: parseSRT, timeToMilliseconds, getBrightColor) ---
// (Keep these functions as they were)
function parseSRT(srtContent) {
    const parsedLyrics = [];
    const blocks = srtContent.trim().split('\n\n');
    
    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) continue;
        
        const timeCode = lines[1];
        const times = timeCode.split(' --> ');
        if (times.length !== 2) continue;
        
        const startTime = timeToMilliseconds(times[0]);
        const endTime = timeToMilliseconds(times[1]);
        const text = lines.slice(2).join(' ');
        const randomColor = getBrightColor();
        
        // Get random positions within the visible viewport, using percentage-based coordinates
        const randomPos = randomPositionInViewport(
            -0.8, 0.8,  // x range: -80% to 80% of viewport width
            -0.8, 0.8,  // y range: -80% to 80% of viewport height
            -250, -50   // z range remains the same
        );
        
        parsedLyrics.push({
            text: text,
            startTime: startTime,
            endTime: endTime,
            active: false,
            color: randomColor,
            size: THREE.MathUtils.randInt(40, 70),
            threeGroup: null,
            letterMeshes: [],
            // Use viewport-aware positioning
            targetX: randomPos.x,
            targetY: randomPos.y,
            targetZ: randomPos.z,
            currentX: randomPos.x,
            currentY: randomPos.y,
            currentZ: randomPos.z,
        });
    }
    
    return parsedLyrics;
}
function timeToMilliseconds(timeString) { /* ... your logic ... */
    timeString = timeString.replace(',', '.'); const parts = timeString.split(/[:.]/); if (parts.length !== 4) return 0; const [hours, minutes, seconds, milliseconds] = parts.map(Number); return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}
function getBrightColor() { /* ... your logic ... */
    const colors = ["#FF5733", "#33FFF5", "#FFFC33", "#FF33F5", "#33FF57", "#5733FF", "#FF3366", "#66FF33", "#33BBFF", "#FF9933"]; return colors[Math.floor(Math.random() * colors.length)];
}


// --- Lyric Object Creation (Updated with font loading checks) ---
function createLyricObjects() {
    console.log(`Creating lyric objects with font: ${FONT_FACE}`);
    
    lyrics.forEach(lyric => {
        // Create group for this lyric text line
        const lineGroup = new THREE.Group();
        lineGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);
        
        // Split text into characters and prepare for layout
        const charArray = lyric.text.split('');
        let currentXOffset = 0;
        const meshes = [];
        
        // First pass - calculate total width
        let totalWidth = 0;
        let spaceWidth = FONT_SIZE * LETTER_SPACING_FACTOR * 0.5;
        let lettersWidth = 0;
        
        // Pre-create all letter meshes to know their actual widths
        const letterMeshObjects = [];
        
        charArray.forEach(char => {
            if (char === ' ') {
                totalWidth += spaceWidth;
            } else {
                const letterObj = createLetterMesh(char, FONT_SIZE, lyric.color);
                letterMeshObjects.push(letterObj);
                totalWidth += letterObj.width;
                lettersWidth += letterObj.width;
            }
        });
        
        // Account for letter spacing between characters
        totalWidth += (charArray.length - 1) * (FONT_SIZE * LETTER_SPACING_FACTOR * 0.3);
        
        // Center all characters - start x position at negative half of total width
        currentXOffset = -totalWidth / 2;
        
        // Generate random initial positions throughout the viewport
        const initialRandomPos = () => {
            // Get random positions covering most of the viewport
            const randPos = randomPositionInViewport(-0.9, 0.9, -0.9, 0.9, -300, -100);
            return {
                x: randPos.x,
                y: randPos.y,
                z: randPos.z
            };
        };
        
        // Second pass - position the meshes with proper centering
        let letterIndex = 0;
        
        charArray.forEach((char, index) => {
            if (char === ' ') {
                // Just advance the offset for spaces
                currentXOffset += spaceWidth;
                return;
            }
            
            // Get the pre-created letter mesh object
            const { mesh, width: charWidth } = letterMeshObjects[letterIndex++];
            
            // Generate random initial positions for animation
            const initialPos = initialRandomPos();
            mesh.userData.initialX = initialPos.x;
            mesh.userData.initialY = initialPos.y;
            mesh.userData.initialZ = initialPos.z;
            
            // Set initial position to the random one (for intro animation)
            mesh.position.set(
                mesh.userData.initialX,
                mesh.userData.initialY,
                mesh.userData.initialZ
            );
            
            // Set target position (centered)
            mesh.userData.targetX = currentXOffset + (charWidth / 2);
            mesh.userData.targetY = 0;
            mesh.userData.targetZ = index * 0.01; // Small z offset for layering
            
            // Random initial rotation
            mesh.rotation.set(
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2,
                Math.random() * Math.PI * 2
            );
            
            // Target rotation (flat)
            mesh.userData.targetRotX = 0;
            mesh.userData.targetRotY = 0;
            mesh.userData.targetRotZ = 0;
            
            // Add to scene graph
            lineGroup.add(mesh);
            meshes.push(mesh);
            
            // Advance the offset for next character
            currentXOffset += charWidth + (FONT_SIZE * LETTER_SPACING_FACTOR * 0.3);
        });
        
        // Store references and add to scene
        lyric.threeGroup = lineGroup;
        lyric.letterMeshes = meshes;
        lineGroup.visible = false;
        scene.add(lineGroup);
    });
    
    console.log("Created Three.js objects for lyrics.");
}

function applyLetterScaling(letterMesh, audioLevel) {
    // Base scale (can be adjusted)
    const baseScale = 0.5;
    
    // Get the world position of this letter mesh
    const letterPosition = new THREE.Vector3();
    letterMesh.getWorldPosition(letterPosition);
    
    // Calculate distance from mouse to this letter
    const distance = letterPosition.distanceTo(mouseWorldPosition);
    
    // Configure how the scale behaves
    const maxDistance = 150; // Maximum effective distance
    const maxScale = 1.5 + audioLevel * 0.5; // Maximum scale factor (boosted by audio)
    const minScale = 0.8; // Minimum scale factor
    
    // Calculate scale factor based on distance (inverse relationship)
    // Closer = bigger, farther = smaller
    let scaleFactor;
    if (distance < maxDistance) {
        // Smooth falloff from maxScale to baseScale
        scaleFactor = minScale + (maxScale - minScale) * (1 - distance / maxDistance);
    } else {
        scaleFactor = minScale; // Default to base scale if too far
    }
    
    // Apply scale - smooth transition using lerp for natural feel
    letterMesh.scale.lerp(new THREE.Vector3(scaleFactor, scaleFactor, scaleFactor), 0.1);
}

// Updated createLetterMesh function to add a stroke
function createLetterMesh(char, size, color = LETTER_COLOR) {
    // Create a canvas element to draw the text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Define stroke thickness - adjust this value for desired thickness
    const strokeWidth = 8; // "Thick" stroke width

    // Set font size and font family (using the loaded custom font)
    const font = `${size}px ${FONT_FACE}`;
    ctx.font = font;

    // Measure the text to determine canvas size, considering the stroke
    const metrics = ctx.measureText(char);
    let textWidth = metrics.width;

    // Estimate required canvas size, adding padding for the stroke width
    // Power-of-two dimensions are often good for textures
    const padding = strokeWidth * 2; // Add padding on both sides
    const canvasWidth = THREE.MathUtils.ceilPowerOfTwo(textWidth + padding);
    // Ensure height accommodates font ascent/descent + stroke
    const canvasHeight = THREE.MathUtils.ceilPowerOfTwo(size * 1.2 + padding);

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // --- Drawing on Canvas (Stroke First, then Fill) ---

    // Recalculate font settings for the resized canvas
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Stroke settings
    ctx.strokeStyle = 'red'; // Stroke color
    ctx.lineWidth = strokeWidth; // Stroke thickness
    ctx.lineJoin = 'round'; // Makes corners look smoother
    ctx.miterLimit = 2; // Affects sharp corners

    // Draw the stroke (outline) first
    // Position text in the center of the larger canvas
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    ctx.strokeText(char, centerX, centerY);

    // Fill settings
    ctx.fillStyle = color; // Use the original letter color for the fill

    // Draw the filled text on top of the stroke
    ctx.fillText(char, centerX, centerY);

    // --- Create Three.js Objects ---

    // Create a texture from the canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Create a plane geometry matching the canvas aspect ratio
    // Use the actual canvas dimensions for accurate aspect ratio
    const planeHeight = size * (canvasHeight / (size * 1.2)); // Scale height based on canvas vs font size ratio
    const planeWidth = planeHeight * (canvasWidth / canvasHeight);
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        // color: 0xffffff, // Color is now baked into texture, keep material white
        transparent: true,
        alphaTest: 0.1, // Helps clean up transparent edges slightly
        side: THREE.DoubleSide,
        depthWrite: true
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Return the mesh and its calculated width for layout purposes
    // Note: The returned 'width' should ideally represent the visual width for spacing,
    // which is now slightly larger due to the stroke. We'll return planeWidth for geometry consistency.
    return { mesh, width: planeWidth };
}


// --- Controls (Your function: setupControls with manual timer logic) ---
// (Keep this function as it was)
function setupControls() {
    const playButton = document.getElementById('play-btn');
    const pauseButton = document.getElementById('pause-btn');
    
    // Main function to handle audio playback with iOS compatibility
    async function handlePlayAudio() {
        try {
            console.log("Play button pressed, audio context state:", listener.context.state);
            
            // Step 1: Always try to resume the AudioContext first
            if (listener.context.state === 'suspended') {
                await listener.context.resume();
                console.log("AudioContext resumed successfully");
            }
            
            // Step 2: Check if we can play audio
            if (sound && sound.buffer && listener.context.state === 'running') {
                // iOS sometimes needs a small delay after context resume
                setTimeout(() => {
                    if (!sound.isPlaying) {
                        const firstLyricStartTimeMs = lyrics[0]?.startTime ?? 0;
                        audioOffset = firstLyricStartTimeMs / 1000.0;
                        sound.offset = audioOffset;
                        
                        // Explicitly set volume (helps with iOS)
                        sound.setVolume(0.5);
                        
                        // Play with error handling
                        try {
                            sound.play();
                            audioStartTimestamp = performance.now() / 1000;
                            audioPaused = false;
                            console.log(`Playing audio: offset=${audioOffset.toFixed(3)}s, timestamp=${audioStartTimestamp.toFixed(3)}s`);
                        } catch (playError) {
                            console.error("Error during play():", playError);
                        }
                    } else {
                        console.log("Sound is already playing");
                    }
                }, 100); // Small delay helps on iOS
            } else {
                console.log("Cannot play audio:", { 
                    hasSound: !!sound, 
                    hasBuffer: !!(sound && sound.buffer),
                    contextState: listener.context.state 
                });
            }
        } catch (err) {
            console.error("Error during play button handler:", err);
        }
    }
    
    // Handle pause with iOS compatibility
    function handlePauseAudio() {
        try {
            if (sound && sound.isPlaying) {
                const currentPlaybackTime = getCurrentPlaybackTime();
                sound.pause();
                audioOffset = currentPlaybackTime;
                audioPaused = true;
                console.log("Paused at offset:", audioOffset);
            } else {
                console.log("Cannot pause: sound is not playing");
            }
        } catch (err) {
            console.error("Error during pause:", err);
        }
    }
    
    // Add both click and touch events for iOS compatibility
    playButton.addEventListener('click', handlePlayAudio);
    playButton.addEventListener('touchend', function(e) {
        e.preventDefault(); // Prevent double-firing with click
        handlePlayAudio();
    });
    
    pauseButton.addEventListener('click', handlePauseAudio);
    pauseButton.addEventListener('touchend', function(e) {
        e.preventDefault();
        handlePauseAudio();
    });
    
    // Add audio unlocking function for iOS
    setupiOSAudioUnlock();
}

// Add this helper function for iOS audio unlocking
function setupiOSAudioUnlock() {
    console.log("Setting up iOS audio unlock handlers");
    
    // Function to unlock audio on iOS
    const unlockAudio = async () => {
        if (!listener || !listener.context) {
            console.log("Audio listener not initialized yet");
            return;
        }
        
        if (listener.context.state === 'suspended') {
            try {
                await listener.context.resume();
                console.log("Audio context unlocked via user gesture");
                
                // Create and play a silent buffer (crucial for iOS)
                const silentBuffer = listener.context.createBuffer(1, 1, 22050);
                const source = listener.context.createBufferSource();
                source.buffer = silentBuffer;
                source.connect(listener.context.destination);
                source.start(0);
                source.stop(0.001); // Very short sound
                
                console.log("Silent buffer played to fully unlock audio");
            } catch (error) {
                console.error("Failed to unlock audio context:", error);
            }
        }
    };
    
    // Add event listeners to various user interactions
    document.addEventListener('touchstart', unlockAudio, { once: true });
    document.addEventListener('touchend', unlockAudio, { once: true });
    document.addEventListener('click', unlockAudio, { once: true });
    
    // For debugging
    if (listener && listener.context) {
        listener.context.onstatechange = () => {
            console.log("Audio context state changed to:", listener.context.state);
        };
    }
}


// --- Manual Timer (Your function: getCurrentPlaybackTime) ---
// (Keep this function as it was)
function getCurrentPlaybackTime() { if (audioPaused) { return audioOffset; } else { const elapsedSinceStart = (performance.now() / 1000) - audioStartTimestamp; return audioOffset + elapsedSinceStart; } }


// --- Update Logic (Your function: updateActiveLyricsThreeJS) ---
// (Keep this function as it was)
function updateActiveLyricsThreeJS(currentTimeSeconds) {
    const currentTimeMs = currentTimeSeconds * 1000;
    const fadeInTime = 150;
    const fadeOutTime = 150;
    
    lyrics.forEach(lyric => {
        const wasActive = lyric.active;
        
        const isInFadeInZone = (currentTimeMs >= lyric.startTime - fadeInTime && currentTimeMs < lyric.startTime);
        const isInActiveZone = (currentTimeMs >= lyric.startTime && currentTimeMs <= lyric.endTime);
        const isInFadeOutZone = (currentTimeMs > lyric.endTime && currentTimeMs <= lyric.endTime + fadeOutTime);
        
        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;
        
        if (lyric.threeGroup) {
            lyric.threeGroup.visible = lyric.active;
        }
        
        // When a lyric becomes active, give it a new random target position
        // using the viewport-aware positioning
        if (lyric.active && !wasActive) {
            const newPos = randomPositionInViewport(
                -0.8, 0.8,  // x range: -80% to 80% of viewport width
                -0.8, 0.8,  // y range: -80% to 80% of viewport height
                -250, -50   // z range
            );
            
            lyric.targetX = newPos.x;
            lyric.targetY = newPos.y;
            lyric.targetZ = newPos.z;
        }
    });
}


// --- Animation Loop (Replace your existing animate function) ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // Calculate Manual Playback Time
    let currentPlaybackTime = getCurrentPlaybackTime();

    // Audio Analysis (keep your existing audio analysis code here)
    let audioLevel = 0;
    let bass = 0, mid = 0, treble = 0;
    if (analyser && (sound.isPlaying || !audioPaused)) {
        const freqData = analyser.getFrequencyData();
        const bassEnd = Math.floor(FFT_SIZE * 0.1);
        const midEnd = Math.floor(FFT_SIZE * 0.4);
        const trebleEnd = Math.floor(FFT_SIZE / 2);
        
        let bassSum = 0;
        for (let i = 1; i < bassEnd; i++) bassSum += freqData[i];
        bass = (bassSum / (bassEnd - 1 || 1) / 255.0) * 2.0;
        
        let midSum = 0;
        for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i];
        mid = (midSum / (midEnd - bassEnd || 1) / 255.0) * 2.0;
        
        let trebleSum = 0;
        for (let i = midEnd; i < trebleEnd; i++) trebleSum += freqData[i];
        treble = (trebleSum / (trebleEnd - midEnd || 1) / 255.0) * 2.0;
        
        audioLevel = (analyser.getAverageFrequency() / 255.0);
        updateActiveLyricsThreeJS(currentPlaybackTime);
    } else {
        // Preview mode
        audioLevel = Math.sin(elapsedTime * 2) * 0.5 + 0.5;
        bass = mid = treble = audioLevel;
        if (lyrics.length > 0) {
            lyrics.forEach((lyric, i) => lyric.active = (i === 0));
            if(lyrics[0].threeGroup) lyrics[0].threeGroup.visible = true;
        }
    }
    
    // Update camera based on mouse/touch interaction
    updateCamera(deltaTime, audioLevel, bass);

    // Update lyric objects (keep your existing lyrics update code here)
    lyrics.forEach(lyric => {
        if (lyric.active && lyric.threeGroup) {
            // Lerp group position
            lyric.currentX = THREE.MathUtils.lerp(lyric.currentX, lyric.targetX, 0.05);
            lyric.currentY = THREE.MathUtils.lerp(lyric.currentY, lyric.targetY, 0.05);
            lyric.currentZ = THREE.MathUtils.lerp(lyric.currentZ, lyric.targetZ, 0.05);
            lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

            // Update letters
            lyric.letterMeshes.forEach((mesh, index) => {
                const moveSpeed = 0.08;
                mesh.position.lerp(
                    new THREE.Vector3(
                        mesh.userData.targetX,
                        mesh.userData.targetY,
                        mesh.userData.targetZ
                    ),
                    moveSpeed
                );
                
                const rotSpeed = 0.1;
                const targetQuaternion = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(
                        mesh.userData.targetRotX,
                        mesh.userData.targetRotY,
                        mesh.userData.targetRotZ
                    )
                );
                mesh.quaternion.slerp(targetQuaternion, rotSpeed);
                applyLetterScaling(mesh, audioLevel);
            });
        }
    });

    // === PING-PONG RENDERING IMPLEMENTATION ===
    
    // STEP 1: Render the scene to render target A
    renderer.setRenderTarget(renderTargetA);
    renderer.clear();
    renderer.render(scene, camera);
    
    // STEP 2: Update shader uniforms
    // Feedback shader uses the current frame (A) and previous feedback result (B)
    feedbackShader.uniforms.tDiffuse.value = renderTargetA.texture;
    feedbackShader.uniforms.prevFrame.value = renderTargetB.texture;
    feedbackShader.uniforms.time.value = elapsedTime;
    feedbackShader.uniforms.audioLevel.value = audioLevel;
    feedbackShader.uniforms.feedbackAmount.value = 0.90 + audioLevel * 0.05;
    
    // STEP 3: Render the feedback effect to a temporary target
    // Create a temporary target instead of reusing B (to avoid feedback loop)
    const tempTarget = new THREE.WebGLRenderTarget(
        renderTargetA.width, 
        renderTargetA.height, 
        {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat
        }
    );
    
    // Add the feedback quad to the scene and render
    quadScene.clear();
    quadScene.add(feedbackQuad);
    renderer.setRenderTarget(tempTarget);
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    
    // STEP 4: Apply glitch effect and render to screen
    glitchShader.uniforms.tDiffuse.value = tempTarget.texture;
    glitchShader.uniforms.time.value = elapsedTime;
    glitchShader.uniforms.audioLevel.value = audioLevel;
    glitchShader.uniforms.intensity.value = 0.1 + audioLevel * 0.3;
    
    // Replace the quad in the scene
    quadScene.clear();
    quadScene.add(outputQuad);
    
    // Render to the screen
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    
    // STEP 5: Copy the current feedback result to renderTargetB for next frame
    renderer.setRenderTarget(renderTargetB);
    renderer.clear();
    
    // Create a simple copy material
    const copyMaterial = new THREE.MeshBasicMaterial({ 
        map: tempTarget.texture,
        depthTest: false,
        depthWrite: false
    });
    
    // Create a temporary quad for copying
    const copyQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        copyMaterial
    );
    
    // Copy to render target B
    quadScene.clear();
    quadScene.add(copyQuad);
    renderer.render(quadScene, quadCamera);
    
    // Clean up
    renderer.setRenderTarget(null);
    tempTarget.dispose();
    copyMaterial.dispose();
    
    // The next frame will now use renderTargetB as the previous frame
}

// Add camera update function
function updateCamera(deltaTime, audioLevel, bassLevel) {
    // Automatic subtle movement when not interacting (centered around 0)
    if (!isInteracting) {
        const time = clock.getElapsedTime();
        // Use smaller amplitudes for a gentler drift
        targetMouseX = Math.sin(time * 0.3) * 0.5;
        targetMouseY = Math.cos(time * 0.4) * 0.4;
    }

    // Smoothly interpolate mouse input values towards the target
    // These values now represent angular displacement factors rather than direct position offsets
    mouseX = THREE.MathUtils.lerp(mouseX, targetMouseX, 0.08); // Slightly faster lerp for responsiveness
    mouseY = THREE.MathUtils.lerp(mouseY, targetMouseY, 0.08);

    // --- Orbit Calculation ---
    const baseDistance = 250;
    const audioDistanceFactor = audioLevel * 50; // How much audio pushes/pulls the camera
    const currentDistance = baseDistance - audioDistanceFactor;

    // Define sensitivity - how much mouse movement translates to rotation angle
    const rotationSensitivity = 0.01; // Adjust as needed

    // Calculate horizontal (around Y-axis) and vertical (around X-axis) angles
    // We add PI to horizontal angle to start looking from +Z axis if mouseX is 0
    const horizontalAngle = mouseX * rotationSensitivity; // Azimuth
    const verticalAngle = -mouseY * rotationSensitivity * 1.5; // Elevation (inverted Y, reduced sensitivity)

    // Clamp vertical angle to prevent flipping over the poles
    const maxVerticalAngle = Math.PI / 2 - 0.1; // Limit to slightly less than 90 degrees
    const clampedVerticalAngle = THREE.MathUtils.clamp(verticalAngle, -maxVerticalAngle, maxVerticalAngle);

    // Calculate camera position using spherical coordinates
    // Y-up coordinate system:
    // x = distance * cos(vertical) * sin(horizontal)
    // y = distance * sin(vertical)
    // z = distance * cos(vertical) * cos(horizontal)
    camera.position.x = currentDistance * Math.cos(clampedVerticalAngle) * Math.sin(horizontalAngle);
    camera.position.y = currentDistance * Math.sin(clampedVerticalAngle);
    camera.position.z = currentDistance * Math.cos(clampedVerticalAngle) * Math.cos(horizontalAngle);

    // Always look at the scene's origin (the central anchor point)
    camera.lookAt(0, 0, 0);

    // Optional: Add a subtle roll based on horizontal movement for dynamism
    // camera.up.set(0, 1, 0); // Reset up vector first
    // camera.up.applyAxisAngle(new THREE.Vector3(0, 0, 1), horizontalAngle * 0.05);
    // This roll is subtle and might be desirable or not, uncomment to test.
}

// --- Event Handlers ---
function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Update mouse interaction variables
    windowHalfX = width / 2;
    windowHalfY = height / 2;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Recalculate viewport dimensions with new aspect ratio
    updateViewportDimensions();

    renderer.setSize(width, height);

    // Resize composer and render targets
    if (composer) {
        composer.setSize(width, height);
        const pixelRatio = renderer.getPixelRatio();
        if (renderTargetA) renderTargetA.setSize(width * pixelRatio, height * pixelRatio);
        if (renderTargetB) renderTargetB.setSize(width * pixelRatio, height * pixelRatio);
    }
}

// --- Run ---
init().catch(err => { // Add catch block for async init errors
    console.error("Initialization failed:", err);
});