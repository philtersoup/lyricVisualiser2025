import * as THREE from 'three';
// Import OrbitControls for basic camera interaction during development (optional)
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// Import post-processing modules
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// Import Stats.js for FPS counter
import Stats from 'three/addons/libs/stats.module.js';

// --- Global Variables ---

// Core Three.js
let scene, camera, renderer;
let stats;

// Font Atlas
let atlasTexture = null;
let atlasMaterial = null;
const charUVData = {}; // Stores { x, y, width, height, glyphWidth } for each char on the atlas
const ATLAS_PADDING = 30; // Pixels between chars on atlas
const ATLAS_CHAR_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?'()[]{}<>:-_=+* "; //

// Post-Processing
// ... (rest of post-processing variables)
let renderTargetA, renderTargetB;
let feedbackShader, glitchShader;
let quadScene, quadCamera;
let feedbackQuad, outputQuad;
const resolutionScale = 0.55;
let copyMaterial, copyQuad; // For the copy pass

// Audio
// ... (rest of audio variables)
let listener, sound, audioLoader, analyser;
const FFT_SIZE = 512;

// Lyrics
// ... (rest of lyrics variables)
let lyrics = [];
let srtLoaded = false;

// Animation / Timing
// ... (rest of animation variables)
const clock = new THREE.Clock();
let audioStartTimestamp = 0;
let audioPaused = true;
let audioOffset = 0;
let averageActiveLyricZ = -150;

// Mouse/Touch Interaction
// ... (rest of interaction variables)
let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
let windowHalfX = window.innerWidth / 2, windowHalfY = window.innerHeight / 2;
let isInteracting = false;
let touchStartX = 0, touchStartY = 0;
const raycaster = new THREE.Raycaster();
const mouse3D = new THREE.Vector2();
const mousePlaneZ = -100;
const mouseWorldPosition = new THREE.Vector3();

// Gyroscope / Mobile Interaction
// ... (rest of gyro variables)
let isMobile = false;
let useGyro = false;
let initialDeviceAlpha = null;
let currentDeviceAlpha = 0, currentDeviceBeta = 0, currentDeviceGamma = 0;
let targetDevicePitch = 0, targetDeviceYaw = 0;
const gyroLerpFactor = 0.1;

let viewportWorldWidth = 0;
let viewportWorldHeight = 0;
let aspectRatio = 1;

// --- Shader Paths ---
const FEEDBACK_VERTEX_PATH = '/shaders/feedback.vert.glsl';
const FEEDBACK_FRAGMENT_PATH = '/shaders/feedback.frag.glsl';
const GLITCH_VERTEX_PATH = '/shaders/glitch.vert.glsl';
const GLITCH_FRAGMENT_PATH = '/shaders/glitch.frag.glsl';

// --- Constants ---
const FONT_SIZE = 50; // Base font size for atlas generation
let FONT_FACE = 'sans-serif'; // Default, updated by loadCustomFont
const FONT_FILE_PATH = 'Blackout Midnight.ttf';
const FONT_FAMILY_NAME = 'Blackout Midnight';
// LETTER_COLOR is now handled by vertex colors, atlas uses white
const LETTER_SPACING = 1;
// const RENDER_SCALE_MULTIPLIER = 1.8;
const STROKE_WIDTH = 0; // Stroke width on the atlas
const STROKE_COLOR = 'red'; // Stroke color on the atlas
let customFontLoaded = false;

// --- OPTIMIZATION: Reusable temporary objects ---
const _tempVec3 = new THREE.Vector3();
const _tempVec3_b = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler();
const _tempColor = new THREE.Color(); // For setting vertex colors


// --- Utility Functions ---
// ... (updateMouse3DPosition, updateViewportDimensions, getWorldPositionFromPercent, randomPositionInViewport, timeToMilliseconds, getBrightColor, getCurrentPlaybackTime remain the same) ...
function updateMouse3DPosition(event) {
    if (!camera) return;

    mouse3D.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse3D.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse3D, camera);

    const planeZ = averageActiveLyricZ; // Use average active lyric Z
    const planeNormal = _tempVec3.set(0, 0, 1);
    const planeConstant = -planeZ;
    const plane = new THREE.Plane(planeNormal, planeConstant);

    raycaster.ray.intersectPlane(plane, mouseWorldPosition);

    if (!mouseWorldPosition || isNaN(mouseWorldPosition.x)) {
       // Fallback if intersection fails (e.g., camera looking parallel)
       mouseWorldPosition.set(0, 0, planeZ);
    }
}

function updateViewportDimensions() {
    if (!camera) return;
    const fov = camera.fov * (Math.PI / 180);
    // Use a consistent depth reference, e.g., the default average Z
    const zDepth = -150;
    const distance = Math.abs(zDepth - camera.position.z);
    viewportWorldHeight = 2 * Math.tan(fov / 2) * distance;
    aspectRatio = window.innerWidth / window.innerHeight;
    viewportWorldWidth = viewportWorldHeight * aspectRatio;
}

function getWorldPositionFromPercent(xPercent, yPercent, zDepth) {
    const worldX = (xPercent * viewportWorldWidth) / 2;
    const worldY = (yPercent * viewportWorldHeight) / 2;
    return { x: worldX, y: worldY, z: zDepth };
}

function randomPositionInViewport(
    xMinPercent = -0.3, xMaxPercent = 0.3,
    yMinPercent = -0.3, yMaxPercent = 0.3,
    zMinDepth = -250, zMaxDepth = -50
) {
    const xPercent = THREE.MathUtils.randFloat(xMinPercent, xMaxPercent);
    const yPercent = THREE.MathUtils.randFloat(yMinPercent, yMaxPercent);
    const zDepth = THREE.MathUtils.randFloat(zMinDepth, zMaxDepth);
    return getWorldPositionFromPercent(xPercent, yPercent, zDepth);
}

function timeToMilliseconds(timeString) {
    timeString = timeString.replace(',', '.');
    const parts = timeString.split(/[:.]/);
    if (parts.length !== 4) return 0;
    const [hours, minutes, seconds, milliseconds] = parts.map(Number);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
}

function getBrightColor() {
    const colors = ["#FF5733", "#33FFF5", "#FFFC33", "#FF33F5", "#33FF57", "#5733FF", "#FF3366", "#66FF33", "#33BBFF", "#FF9933"];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getCurrentPlaybackTime() {
    if (audioPaused) {
        return audioOffset;
    } else {
        const elapsedSinceStart = (performance.now() / 1000) - audioStartTimestamp;
        return Math.max(0, audioOffset + elapsedSinceStart); // Ensure non-negative
    }
}


// --- Interaction Setup (Modified for Gyro) ---
// ... (setupInteraction, handleDeviceOrientation, interaction handlers remain the same) ...
function setupInteraction() {
    // Basic mobile detection
    isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Gyroscope setup (only if mobile)
    if (isMobile && window.DeviceOrientationEvent) {
        console.log("Mobile device detected, attempting to use Device Orientation.");
        // Check for permission API (newer method, mainly iOS 13+)
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
             const buttonId = 'enable-motion-btn';
             let existingButton = document.getElementById(buttonId);
             // Create button only if it doesn't exist
             if (!existingButton) {
                 const button = document.createElement('button');
                 button.id = buttonId; // Give it an ID
                 button.textContent = 'Enable Motion Control';
                 // Basic Styling (adjust as needed)
                 button.style.cssText = `
                    position: absolute; top: 50%; left: 50%;
                    transform: translate(-50%, -50%); padding: 15px;
                    font-size: 1.2em; z-index: 1001; cursor: pointer;
                    background-color: #333; color: #fff; border: none; border-radius: 5px;
                 `;
                 button.onclick = async () => {
                    try {
                        button.textContent = 'Requesting...'; button.disabled = true;
                        const permissionState = await DeviceOrientationEvent.requestPermission();
                        if (permissionState === 'granted') {
                            window.addEventListener('deviceorientation', handleDeviceOrientation);
                            useGyro = true;
                            console.log("Device Orientation permission granted.");
                            button.remove();
                        } else {
                             console.warn("Device Orientation permission denied.");
                             button.textContent = 'Motion Control Denied';
                             // Keep button disabled but visible
                        }
                    } catch (error) {
                         console.error("Error requesting Device Orientation permission:", error);
                         button.textContent = 'Error Enabling Motion';
                         // Keep button disabled but visible
                    }
                 };
                 document.body.appendChild(button);
                 existingButton = button; // Reference the newly created button
             }
             // Ensure button is visible if loader is still showing
             const loadingIndicator = document.getElementById('loading-indicator');
             if (loadingIndicator && !loadingIndicator.classList.contains('hidden')) {
                existingButton.style.display = 'block'; // Or 'inline-block'
             }

        } else {
             // Assume permission is not required for older devices/browsers
             console.log("Attempting to add deviceorientation listener directly (no permission request needed/possible).");
             window.addEventListener('deviceorientation', handleDeviceOrientation);
             useGyro = true; // Assume it will work
        }
    } else {
         console.log("Device Orientation not available or not a mobile device. Using mouse/touch for camera.");
    }

    // Add standard listeners regardless of gyro (touch needed for scale)
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('mouseup', onDocumentMouseUp);
    document.addEventListener('touchstart', onDocumentTouchStart, { passive: false });
    document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', onDocumentTouchEnd);
    console.log("Interaction listeners setup complete.");
}

function handleDeviceOrientation(event) {
    // Clamp beta to avoid excessive tilting, gamma for roll if needed
    const beta = THREE.MathUtils.clamp(event.beta ?? 0, -90, 90);
    const alpha = event.alpha ?? 0; // Compass heading (0-360)
    const gamma = event.gamma ?? 0; // Roll (-90 to 90)

    currentDeviceAlpha = alpha;
    currentDeviceBeta = beta;
    currentDeviceGamma = gamma;

    if (initialDeviceAlpha === null && event.alpha !== null) { // Initialize only once with a valid alpha
        initialDeviceAlpha = currentDeviceAlpha;
    }

    if (initialDeviceAlpha !== null) {
        let deltaAlpha = currentDeviceAlpha - initialDeviceAlpha;
        // Handle wrap-around
        if (deltaAlpha > 180) { deltaAlpha -= 360; }
        else if (deltaAlpha < -180) { deltaAlpha += 360; }

        const yawRad = THREE.MathUtils.degToRad(-deltaAlpha); // Invert for intuitive rotation
        const pitchRad = THREE.MathUtils.degToRad(currentDeviceBeta);

        // Lerp towards target for smoothing
        targetDeviceYaw = THREE.MathUtils.lerp(targetDeviceYaw, yawRad, gyroLerpFactor);
        targetDevicePitch = THREE.MathUtils.lerp(targetDevicePitch, pitchRad, gyroLerpFactor);
        // targetDeviceRoll = THREE.MathUtils.lerp(targetDeviceRoll, THREE.MathUtils.degToRad(currentDeviceGamma), gyroLerpFactor); // If using roll
    } else {
         targetDeviceYaw = 0;
         targetDevicePitch = 0;
         // targetDeviceRoll = 0;
    }
}

function onDocumentMouseMove(event) {
    if (!useGyro) { // Only update camera target if not using gyro
        targetMouseX = (event.clientX - windowHalfX);
        targetMouseY = (event.clientY - windowHalfY);
    }
    updateMouse3DPosition(event); // Always update 3D pos for scaling
}

function onDocumentMouseDown(event) {
   isInteracting = true;
    if (!useGyro) { // Only track mouse for camera if not using gyro
       touchStartX = event.clientX - windowHalfX;
       touchStartY = event.clientY - windowHalfY;
       targetMouseX = touchStartX;
       targetMouseY = touchStartY;
       mouseX = targetMouseX; // Snap immediately on interaction start
       mouseY = targetMouseY;
    }
    updateMouse3DPosition(event); // Always update 3D pos for scaling
}

function onDocumentMouseUp() {
    isInteracting = false;
}

function onDocumentTouchStart(event) {
    if (event.touches.length === 1) {
        event.preventDefault(); // Prevent default scroll/zoom
        isInteracting = true; // Still set interacting flag
        if (!useGyro) { // Only update camera drag start if NOT using gyro
            touchStartX = event.touches[0].pageX - windowHalfX;
            touchStartY = event.touches[0].pageY - windowHalfY;
            targetMouseX = touchStartX;
            targetMouseY = touchStartY;
            mouseX = targetMouseX; // Snap immediately
            mouseY = targetMouseY;
        }
        // ALWAYS update 3D position for scaling effect
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchMove(event) {
    if (event.touches.length === 1) {
        event.preventDefault(); // Prevent default scroll/zoom
         if (!useGyro) { // Only update camera drag target if NOT using gyro
            targetMouseX = event.touches[0].pageX - windowHalfX;
            targetMouseY = event.touches[0].pageY - windowHalfY;
         }
        // ALWAYS update 3D position for scaling effect
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchEnd() {
    isInteracting = false; // Reset interacting flag
}


// --- Font Loading & Atlas Creation ---

async function loadCustomFont() {
    try {
        console.log(`Loading custom font from: ${FONT_FILE_PATH}`);
        const encodedFontFileName = encodeURIComponent(FONT_FILE_PATH);
        const fontFace = new FontFace(FONT_FAMILY_NAME, `url('${encodedFontFileName}') format('truetype')`);
        const loadedFont = await fontFace.load();
        document.fonts.add(loadedFont);
        FONT_FACE = FONT_FAMILY_NAME; // Update global font face
        customFontLoaded = true;
        console.log(`Custom font "${FONT_FAMILY_NAME}" loaded successfully`);
        return true;
    } catch (error) {
        console.error('Error loading custom font:', error);
        console.warn('Falling back to default font:', FONT_FACE);
        // Keep FONT_FACE as the default sans-serif
        return false;
    }
}

// --- createFontAtlas Function (Corrected Drawing Order) ---
function createFontAtlas() {
    console.log("Creating font atlas...");
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${FONT_SIZE}px ${FONT_FACE}`; // Uses global FONT_SIZE & FONT_FACE
    ctx.font = font;

    // --- Calculate Atlas Size ---
    let maxCharWidth = 0;
    let totalWidth = 0;
    const charMetrics = {};

    // Calculate consistent block height FIRST
    // Uses global ATLAS_PADDING & STROKE_WIDTH
    const charBlockHeight = Math.ceil(FONT_SIZE * 1.3 + ATLAS_PADDING * 2 + STROKE_WIDTH * 2);

    // Uses global ATLAS_CHAR_SET
    for (const char of ATLAS_CHAR_SET) {
        const metrics = ctx.measureText(char);
        // Calculate width needed for this char block on the atlas
        const width = Math.max(1, Math.ceil(metrics.width)) + ATLAS_PADDING * 2 + STROKE_WIDTH * 2;
        const height = charBlockHeight; // Use the consistent block height
        charMetrics[char] = {
            width: width, // Block width on canvas
            height: height, // Block height on canvas
            glyphWidth: Math.max(1, metrics.width) // Actual glyph width (for layout/geometry)
        };
        maxCharWidth = Math.max(maxCharWidth, width);
        totalWidth += width;
    }

    // Simple layout: single row, calculate power-of-two dimensions
    const atlasHeight = THREE.MathUtils.ceilPowerOfTwo(charBlockHeight);
    const atlasWidth = THREE.MathUtils.ceilPowerOfTwo(totalWidth);
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    console.log(`Atlas dimensions: ${atlasWidth}x${atlasHeight}`);

    // --- Configure context for drawing ---
    ctx.font = font;
    ctx.fillStyle = '#FFFFFF'; // Fill color (White)
    ctx.strokeStyle = STROKE_COLOR; // Stroke color (from global constant, e.g., 'red' or '#000000')
    ctx.lineWidth = STROKE_WIDTH;   // Stroke width (from global constant, e.g., 2)
    ctx.lineJoin = 'round'; // Style for stroke corners
    ctx.miterLimit = 2;     // Style for stroke corners
    ctx.textAlign = 'center'; // Center horizontally
    ctx.textBaseline = 'middle'; // Center vertically

    // --- Draw characters and store UV data ---
    let currentX = 0;
    for (const char of ATLAS_CHAR_SET) {
        const metrics = charMetrics[char];
        const charWidth = metrics.width;  // Block width for this char
        const charHeight = metrics.height; // Block height for this char

        // Calculate center position within the block area on the canvas row
        const centerX = currentX + charWidth / 2;
        const centerY = charHeight / 2; // Center within the block height

        // --- CORRECTED DRAWING ORDER ---
        // 1. Draw the fill first
        ctx.fillText(char, centerX, centerY);

        // 2. Draw the stroke second (on top of the fill) if width > 0
        if (STROKE_WIDTH > 0) {
            ctx.strokeText(char, centerX, centerY);
        }
        // --- End Corrected Order ---

        // Store UV data based on the BLOCK's position and dimensions on the atlas
        // Uses global charUVData object
        charUVData[char] = {
            x: currentX,      // X position of the block start
            y: 0,             // Y position of the block start (top of the atlas row)
            width: charWidth, // Width of the block
            height: charHeight,// Height of the block
            glyphWidth: metrics.glyphWidth // Store the measured glyph width separately
        };

        // Move to the next character's position
        currentX += charWidth;
    }

    // --- Create Texture and Material ---
    // Uses global atlasTexture & atlasMaterial variables
    atlasTexture = new THREE.CanvasTexture(canvas);
    atlasTexture.minFilter = THREE.LinearFilter;
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.needsUpdate = true; // Important after drawing to canvas

    atlasMaterial = new THREE.MeshBasicMaterial({
        map: atlasTexture,
        transparent: true,         // Needed for transparent background of atlas
        side: THREE.DoubleSide,    // Render both sides (optional, good for rotation)
        vertexColors: true,        // Enable vertex colors set in createLetterMesh
        blending: THREE.NormalBlending, // Standard blending mode
        depthWrite: false // <--- ADD THIS LINE
    });

    console.log("Font atlas created successfully (Fill/Stroke order corrected).");

    // --- Optional: Visualize the generated atlas canvas ---
    // canvas.style.border = "1px solid red";
    // canvas.style.position = "absolute";
    // canvas.style.top = "10px";
    // canvas.style.left = "10px";
    // canvas.style.zIndex = "2000";
    // canvas.style.backgroundColor = "rgba(0, 0, 255, 0.1)";
    // document.body.appendChild(canvas);
    

} // --- End of createFontAtlas ---


// --- Shader Loading ---
// ... (loadShader, loadShaders remain the same) ...
async function loadShader(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status} for ${url}`); }
        return await response.text();
    } catch (e) {
        console.error(`Failed to load shader: ${url}`, e);
        // Provide fallback shaders
        if (url.includes('.vert')) { return `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`; }
        else { return `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`; }
    }
}

async function loadShaders() {
    console.log("Loading shaders...");
    const [feedbackVS, feedbackFS, glitchVS, glitchFS] = await Promise.all([
        loadShader(FEEDBACK_VERTEX_PATH), loadShader(FEEDBACK_FRAGMENT_PATH),
        loadShader(GLITCH_VERTEX_PATH), loadShader(GLITCH_FRAGMENT_PATH)
    ]);
    console.log("Shaders loaded.");
    return { feedbackVS, feedbackFS, glitchVS, glitchFS };
}


// --- Audio Setup & Controls ---
// ... (setupAudio, setupControls, setupiOSAudioUnlock remain the same) ...
function setupAudio() {
    return new Promise((resolve, reject) => {
        listener = new THREE.AudioListener();
        // Add listener to camera AFTER camera is created
        // camera.add(listener); // Moved to init()
        sound = new THREE.Audio(listener);
        audioLoader = new THREE.AudioLoader();
        audioLoader.load('Vessels_Masterv3_4824.mp3',
            buffer => {
                sound.setBuffer(buffer);
                sound.setVolume(0.5); // Adjust volume as needed
                analyser = new THREE.AudioAnalyser(sound, FFT_SIZE);
                console.log("Audio loaded and analyzer created");
                resolve(buffer); // Resolve promise when audio is loaded
            },
            progress => {
                // Optional: Update loading progress
                // console.log(`Audio loading: ${Math.round(progress.loaded / progress.total * 100)}%`);
            },
            error => {
                console.error('Error loading audio:', error);
                reject(error); // Reject promise on error
            }
        );
    });
}

function setupControls() {
    const playButton = document.getElementById('play-btn');
    const pauseButton = document.getElementById('pause-btn');

    // Function to safely start audio playback
    async function handlePlayAudio() {
        if (!sound || !sound.buffer) {
            console.warn("Audio not ready to play.");
            return;
        }
        // Ensure audio context is running (required by browsers)
        try {
            if (listener.context.state === 'suspended') {
                await listener.context.resume();
                console.log("Audio context resumed.");
            }

            // Play only if context is running and sound is not already playing
            if (listener.context.state === 'running' && !sound.isPlaying) {
                sound.offset = audioOffset; // Start from paused position
                sound.play();
                audioStartTimestamp = performance.now() / 1000 - audioOffset; // Recalculate start time
                audioPaused = false;
                console.log("Audio playing, offset:", audioOffset);
            } else if (sound.isPlaying) {
                 console.log("Audio already playing.");
            } else {
                 console.warn("Cannot play audio - context state:", listener.context.state);
            }
        } catch (err) {
            console.error("Error resuming audio context or playing sound:", err);
        }
    }

    // Function to safely pause audio playback
    function handlePauseAudio() {
        if (sound && sound.isPlaying) {
            try {
                audioOffset = getCurrentPlaybackTime(); // Store current position
                sound.pause();
                audioPaused = true;
                console.log("Audio paused at:", audioOffset);
            } catch (err) {
                 console.error("Error during pause:", err);
            }
        } else {
            // console.warn("Cannot pause: sound is not playing.");
        }
    }

    // Add event listeners
    playButton.addEventListener('click', handlePlayAudio);
    playButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePlayAudio(); }); // For mobile touch

    pauseButton.addEventListener('click', handlePauseAudio);
    pauseButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePauseAudio(); }); // For mobile touch

    setupiOSAudioUnlock(); // Handle iOS audio unlock gesture
}

function setupiOSAudioUnlock() {
    // Simple unlock attempt on first user interaction
    const unlockAudio = async () => {
        if (!listener || !listener.context || listener.context.state !== 'suspended') {
            return; // Already running or no context
        }
        try {
            await listener.context.resume();
            console.log("Audio context resumed by user interaction.");
             // Optional: Play a tiny silent buffer to confirm unlock
             const buffer = listener.context.createBuffer(1, 1, 22050);
             const source = listener.context.createBufferSource();
             source.buffer = buffer;
             source.connect(listener.context.destination);
             source.start(0);
             // Short timeout stop to prevent potential glitches
             source.stop(listener.context.currentTime + 0.001);
        } catch (error) {
            console.error("Failed to unlock audio context:", error);
        }
    };

    // Listen for the first pointer down event anywhere
    document.addEventListener('pointerdown', unlockAudio, { once: true });
}


// --- Initialization ---
async function init() {
    console.log("init() called");
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');

    function updateProgress(percent, message = "Loading Visualizer...") {
        if (loadingText) {
            const displayPercent = Math.min(percent, 100);
            loadingText.textContent = `${message} ${displayPercent}%`;
        }
    }

    try {
        updateProgress(0);

        scene = new THREE.Scene();
        aspectRatio = window.innerWidth / window.innerHeight;
        camera = new THREE.PerspectiveCamera(60, aspectRatio, 1, 2000);
        camera.position.set(0, 0, 250); camera.lookAt(scene.position);
        // listener is created in setupAudio, add it here
        // if (listener) camera.add(listener); // Moved listener add after audio setup promise

        updateViewportDimensions();
        windowHalfX = window.innerWidth / 2; windowHalfY = window.innerHeight / 2;

        updateProgress(10, "Loading Font...");
        await loadCustomFont(); // Wait for font

        // --- Create Font Atlas AFTER font loaded ---
        updateProgress(15, "Creating Font Atlas...");
        createFontAtlas(); // Now uses the loaded FONT_FACE


        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.autoClear = false; // Important for post-processing
        document.getElementById('visualizer-container').appendChild(renderer.domElement);

        // --- Setup Stats ---
        stats = new Stats();
        stats.dom.style.position = 'absolute'; stats.dom.style.top = '0px'; stats.dom.style.left = '0px';
        document.body.appendChild(stats.dom);
        // ---

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9); directionalLight.position.set(0.5, 1, -0.5); scene.add(directionalLight);

        updateProgress(20, "Loading Shaders...");
        const shaderCode = await loadShaders(); // Await shaders

        updateProgress(40, "Loading Audio...");
        // Setup audio and wait for it to load before potentially needing the listener
        await setupAudio();
        if (listener) {
             camera.add(listener); // Add listener to camera now
             console.log("Audio Listener added to camera.");
        } else {
             console.error("Audio Listener was not created!");
        }

        updateProgress(60, "Loading Lyrics...");
        let srtText;
        try {
             const srtRes = await fetch('lyrics.srt');
             if (!srtRes.ok) throw new Error(`SRT fetch failed: ${srtRes.status}`);
             srtText = await srtRes.text();
             updateProgress(75, "Parsing Lyrics...");
             lyrics = parseSRT(srtText);
             srtLoaded = true;
        } catch(srtError) {
             console.error("Error loading or parsing SRT:", srtError);
             updateProgress(75, "SRT Load Failed..."); // Update progress even on failure
             // Optionally, display an error to the user
        }

        updateProgress(80, "Creating Objects...");
        if(srtLoaded && atlasMaterial) { // Check atlasMaterial exists too
            createLyricObjects(); // Now uses atlas data
        } else if (!atlasMaterial) {
            console.error("Cannot create lyric objects: Font Atlas Material not ready.");
        } else {
             console.warn("SRT not loaded, skipping lyric object creation.");
        }

        setupPostProcessing(shaderCode); // Setup post-processing effects
        updateProgress(90, "Initializing Controls...");
        setupControls(); // Setup play/pause buttons AFTER audio loaded
        setupInteraction(); // Setup mouse/touch/gyro AFTER camera exists
        window.addEventListener('resize', onWindowResize);

        updateProgress(100, "Ready!");
        console.log("Initialization complete.");

        if (loadingIndicator) {
            const gyroButton = document.getElementById('enable-motion-btn');
            if (gyroButton) gyroButton.remove();
            loadingIndicator.classList.add('hidden');
            setTimeout(() => { loadingIndicator.remove(); }, 700);
        }

        console.log("Starting animation loop...");
        animate();

    } catch (err) {
        console.error("Initialization failed critically:", err);
        if (loadingIndicator) {
            loadingText.textContent = `Error: ${err.message || 'Unknown error'}`;
            loadingIndicator.innerHTML = `<p style="color: red;">Initialization Error: ${err.message || 'Unknown error'}<br/>Please check console.</p>`;
            loadingIndicator.style.backgroundColor = "rgba(50,0,0,0.9)";
            const gyroButton = document.getElementById('enable-motion-btn');
            if (gyroButton) gyroButton.remove();
        }
        if (stats && stats.dom.parentElement) {
            stats.dom.parentElement.removeChild(stats.dom);
        }
        // Clean up atlas resources if they were created before error
        atlasTexture?.dispose();
        atlasMaterial?.dispose();
    }
}


// --- Post-Processing Setup ---
// ... (setupPostProcessing remains the same) ...
// --- Post-Processing Setup ---
// --- Post-Processing Setup ---
function setupPostProcessing(shaderCode) {
    console.log("Setting up post-processing (Using NearestFilter)..."); // Updated log

    // Define width and height based on current window size
    const width = window.innerWidth;
    const height = window.innerHeight;

    // *** Define Render Target Options using NearestFilter ***
    const targetOptions = {
        minFilter: THREE.NearestFilter, // Use NearestFilter
        magFilter: THREE.NearestFilter, // Use NearestFilter
        format: THREE.RGBAFormat,       // Keep RGBA for alpha
        type: THREE.UnsignedByteType, // Standard type
        stencilBuffer: false            // No stencil needed
    };
    // *** --- ***

    const pixelRatio = renderer.getPixelRatio(); // Get device pixel ratio
    // Calculate scaled dimensions for render targets
    const targetWidth = Math.floor(width * pixelRatio * resolutionScale); // Use global resolutionScale
    const targetHeight = Math.floor(height * pixelRatio * resolutionScale);
    console.log(`Setting post-processing resolution to: ${targetWidth}x${targetHeight} (Scale: ${resolutionScale}, Filter: Nearest)`); // Updated log

    // --- Dispose existing resources FIRST ---
    // Important if this function is ever called again (e.g., on resize needing recreation)
    renderTargetA?.dispose();
    renderTargetB?.dispose();
    feedbackShader?.dispose();
    glitchShader?.dispose();
    copyMaterial?.dispose();
    // Note: Geometry is shared, don't dispose it here unless managed carefully
    // quadCamera and quadScene usually don't need disposal unless structure changes
    // --- End Disposal ---

    // --- Create Render Targets with new options ---
    renderTargetA = new THREE.WebGLRenderTarget(targetWidth, targetHeight, targetOptions);
    renderTargetB = new THREE.WebGLRenderTarget(targetWidth, targetHeight, targetOptions);

    // --- Setup Orthographic Camera and Scene for fullscreen quads ---
    // Can reuse if they exist, or recreate; recreating is safer.
    quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadScene = new THREE.Scene();

    // --- Create Shader Materials ---
    // Feedback Shader (ensure it uses shaderCode.feedbackVS/FS)
    feedbackShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            prevFrame: { value: null },
            feedbackAmount: { value: 0.95 }, // Example default
            time: { value: 0.0 },
            audioLevel: { value: 0.0 }
        },
        vertexShader: shaderCode.feedbackVS,
        fragmentShader: shaderCode.feedbackFS,
        depthTest: false, depthWrite: false
    });

    // Glitch Shader (ensure it uses shaderCode.glitchVS/FS)
    // Prepare uniforms even if using hardcoded GLSL for testing outline later
    glitchShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            intensity: { value: 0.1 }, // Example default
            time: { value: 0.0 },
            audioLevel: { value: 0.0 },
            // Add outline uniforms here later if needed, for now structure is minimal
            // Example structure for later:
            // uResolution: { value: new THREE.Vector2(targetWidth, targetHeight) },
            // uOutlineColor: { value: new THREE.Vector4(0.0, 0.0, 0.0, 1.0) },
            // uOutlineThickness: { value: 1.5 },
            // uAlphaThreshold: { value: 0.5 }
        },
        vertexShader: shaderCode.glitchVS,
        fragmentShader: shaderCode.glitchFS, // Assumes this file currently has the simple threshold test
        depthTest: false, depthWrite: false
    });

    // --- Create Copy Material (for ping-pong copy pass) ---
     copyMaterial = new THREE.MeshBasicMaterial({
         map: null, // Map will be set each frame in animate
         depthTest: false,
         depthWrite: false
     });

    // --- Create Meshes using Shared Geometry ---
    // Create geometry once and reuse for all quads
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    feedbackQuad = new THREE.Mesh(quadGeometry, feedbackShader);
    outputQuad = new THREE.Mesh(quadGeometry, glitchShader); // Uses glitchShader
    copyQuad = new THREE.Mesh(quadGeometry, copyMaterial); // Uses copyMaterial

    // --- Explicitly Clear renderTargetB Once on Setup ---
    // Ensures it starts transparent black, regardless of default state
    if (renderer && renderTargetB) { // Check if they exist
        renderer.setRenderTarget(renderTargetB);
        renderer.setClearColor(0x000000, 0.0); // Set clear color to black, alpha to 0
        renderer.setClearAlpha(0.0);          // Explicitly set clear alpha
        renderer.clear(true, true, true);     // Clear color, depth, stencil
        renderer.setRenderTarget(null);       // Reset render target back to default (screen)
        console.log("Initial clear of renderTargetB performed.");
    } else {
        console.error("Failed to perform initial clear on renderTargetB: renderer or target missing.");
    }
    // --- End Initial Clear ---

    console.log("Post-processing setup complete (Using NearestFilter, RTB cleared).");
}


// --- SRT Parsing ---
// ... (parseSRT remains the same, using FONT_SIZE for stacking offset) ...
function parseSRT(srtContent) {
    const parsedLyrics = [];
    const blocks = srtContent.trim().split('\n\n');
    const MAX_LINE_LENGTH = 10; // Adjust as needed
    const LINE_STACKING_OFFSET = FONT_SIZE * 1.1; // Use atlas FONT_SIZE

    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) continue; // Need index, timecode, text

        const timeCode = lines[1];
        const times = timeCode.split(' --> ');
        if (times.length !== 2) continue;

        const startTime = timeToMilliseconds(times[0]);
        const endTime = timeToMilliseconds(times[1]);
        const originalText = lines.slice(2).join(' '); // Join multi-line text

        const randomColor = getBrightColor();
        let textParts = [originalText];
        let wasSplit = false;

        // --- Line Splitting Logic (simplified example) ---
        if (originalText.length > MAX_LINE_LENGTH) {
            let remainingText = originalText;
            let potentialParts = [];
            let safetyBreak = 0;
            const idealSplitPoint = MAX_LINE_LENGTH;
            const searchRadius = 5; // Look slightly before/after ideal split

            while (remainingText.length > MAX_LINE_LENGTH && safetyBreak < 5) { // Limit splits
                safetyBreak++;
                let splitIndex = -1;

                // Look for space near ideal split point
                for (let i = idealSplitPoint; i >= idealSplitPoint - searchRadius && i > 0; i--) {
                    if (remainingText[i] === ' ') { splitIndex = i; break; }
                }
                if (splitIndex === -1) { // If no space before, look after
                    for (let i = idealSplitPoint + 1; i < idealSplitPoint + searchRadius && i < remainingText.length; i++) {
                         if (remainingText[i] === ' ') { splitIndex = i; break; }
                    }
                }
                // If still no space found, force split at MAX_LINE_LENGTH
                if (splitIndex === -1) { splitIndex = MAX_LINE_LENGTH; }

                potentialParts.push(remainingText.substring(0, splitIndex).trim());
                remainingText = remainingText.substring(splitIndex).trim();

                // Add last part if it's short enough
                if (remainingText.length <= MAX_LINE_LENGTH) {
                    potentialParts.push(remainingText);
                    remainingText = ""; // Stop loop
                    break;
                }
            }
            // Add any remaining long part (shouldn't happen often with safetyBreak)
            if (remainingText.length > 0) { potentialParts.push(remainingText); }

            if (potentialParts.length > 1) {
                textParts = potentialParts.filter(part => part.length > 0); // Remove empty parts
                wasSplit = true;
            }
        }
        // --- End Line Splitting ---

        const partCount = textParts.length;
        // Calculate initial position (random within a smaller central area)
        const baseInitialPos = randomPositionInViewport(-0.2, 0.2, -0.15, 0.15, -180, -90);
        const totalHeight = (partCount - 1) * LINE_STACKING_OFFSET;
        const topTargetY = baseInitialPos.y + totalHeight / 2; // Start Y for top line

        textParts.forEach((textPart, index) => {
            const lineTargetY = topTargetY - (index * LINE_STACKING_OFFSET); // Stack downwards
            parsedLyrics.push({
                id: `${startTime}_${index}`,
                text: textPart,
                startTime: startTime,
                endTime: endTime,
                active: false,
                color: randomColor, // Store hex color string
                size: FONT_SIZE, // Store base size (used for spacing maybe?)
                threeGroup: null,
                letterMeshes: [],
                targetX: baseInitialPos.x,
                targetY: lineTargetY, // Unique Y target per line part
                targetZ: baseInitialPos.z,
                currentX: baseInitialPos.x, // Start at target X
                currentY: lineTargetY,     // Start at target Y
                currentZ: baseInitialPos.z - 50, // Start further back
                baseScale: 1.0, // Base scale for the group
                wasSplit: wasSplit,
                disposed: false,
                inactiveTimestamp: null,
            });
        });
    }
    console.log(`Parsed ${blocks.length} SRT blocks into ${parsedLyrics.length} lyric objects.`);
    return parsedLyrics;
}


// --- Lyric Object Creation & Cleanup (Using Atlas) ---

function createLyricObjects() {
    if (!atlasMaterial || Object.keys(charUVData).length === 0) {
        console.error("Cannot create lyric objects: Atlas not ready.");
        return;
    }
    updateViewportDimensions(); // Ensure viewport dimensions are current

    lyrics.forEach(lyric => {
        if (lyric.disposed || lyric.threeGroup) return; // Skip if already created or disposed

        const lineGroup = new THREE.Group();
        lineGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

        const charArray = lyric.text.split('');
        let currentXOffset = 0;
        const meshes = [];
        let totalGlyphWidth = 0;
        // Use a scaled space width - relative to font size or the new spacing constant
        const spaceWidth = FONT_SIZE * 0.3; // Or use LETTER_SPACING here if preferred

        // Pre-calculate total width based on glyph widths and NEW spacing
        charArray.forEach((char, index) => {
            if (char === ' ') {
                totalGlyphWidth += spaceWidth;
            } else {
                const charData = charUVData[char] || charUVData['?'];
                if (charData) {
                    totalGlyphWidth += charData.glyphWidth;
                    // Add spacing AFTER the character, except for the last one
                    if (index < charArray.length - 1 && charArray[index+1] !== ' ') { // Check next isn't space
                       totalGlyphWidth += LETTER_SPACING; // Add the defined spacing
                    }
                } else {
                    totalGlyphWidth += spaceWidth; // Fallback width
                     if (index < charArray.length - 1 && charArray[index+1] !== ' ') {
                       totalGlyphWidth += LETTER_SPACING;
                    }
                    console.warn(`Character "${char}" not found in atlas. Using fallback width.`);
                }
            }
        });

        // --- Calculate scale factor to fit viewport ---
        const maxAllowedWidth = viewportWorldWidth * 0.95;
        let scaleFactor = 1.25; // Default/Max Scale? Let's adjust base scale later if needed
        if (totalGlyphWidth > 0 && totalGlyphWidth > maxAllowedWidth) {
            scaleFactor = maxAllowedWidth / totalGlyphWidth;
        }
        lyric.baseScale = scaleFactor; // Store base scale for the group
        // Group scale is now set in applyLetterScaling based on baseScale
        // lineGroup.scale.set(lyric.baseScale, lyric.baseScale, lyric.baseScale); // Remove this line

        // Center the line: Start offset is negative half the total *scaled* width
        // Recalculate the final scaled width for centering
        const finalScaledWidth = totalGlyphWidth * scaleFactor;
        currentXOffset = -finalScaledWidth / 2;

        _tempColor.set(lyric.color);

        charArray.forEach((char, index) => {
            if (char === ' ') {
                currentXOffset += spaceWidth * scaleFactor; // Apply scale to space width
                return;
            }

            const charData = charUVData[char] || charUVData['?'];
            if (!charData) return;

            // *** Use SCALED glyphWidth for positioning offset calculation ***
            const scaledGlyphWidth = charData.glyphWidth * scaleFactor;

            const createdMesh = createLetterMesh(char, _tempColor); // Use the corrected function

            if (createdMesh) {
                // Position the mesh centered on its upcoming slot
                // The slot starts at currentXOffset and has width scaledGlyphWidth
                const meshCenterX = currentXOffset + (scaledGlyphWidth / 2);
                createdMesh.userData.targetX = meshCenterX;
                createdMesh.userData.targetY = 0;
                createdMesh.userData.targetZ = index * 0.01;

                // Initial animation state (scattered) - Keep as is
                const initialOffsetMagnitude = 30;
                const randomDirection = _tempVec3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
                                                .normalize().multiplyScalar(initialOffsetMagnitude);
                createdMesh.userData.initialX = createdMesh.userData.targetX + randomDirection.x;
                createdMesh.userData.initialY = createdMesh.userData.targetY + randomDirection.y;
                createdMesh.userData.initialZ = createdMesh.userData.targetZ + randomDirection.z + 60;
                createdMesh.position.set(createdMesh.userData.initialX, createdMesh.userData.initialY, createdMesh.userData.initialZ);

                // Initial rotation state (random) - Keep as is
                createdMesh.userData.targetRotX = 0;
                createdMesh.userData.targetRotY = 0;
                createdMesh.userData.targetRotZ = 0;
                createdMesh.rotation.set(
                    THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                    THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                    THREE.MathUtils.randFloatSpread(Math.PI * 0.25)
                );

                // Initial scale will be set in applyLetterScaling using baseScale
                // mesh.scale.set(lyric.baseScale, lyric.baseScale, lyric.baseScale); // Remove initial scale setting here

                lineGroup.add(createdMesh);
                meshes.push(createdMesh);

                // Advance position for the next letter slot
                // Add the scaled glyph width AND the scaled spacing
                currentXOffset += scaledGlyphWidth;
                if (index < charArray.length - 1 && charArray[index+1] !== ' ') { // Check next isn't space
                     currentXOffset += LETTER_SPACING * scaleFactor; // Add scaled spacing
                }
            }
        });

        lyric.threeGroup = lineGroup;
        lyric.letterMeshes = meshes;
        lineGroup.visible = false;
        scene.add(lineGroup);
    });
}

// --- Modified createLetterMesh (UV Test: No V-Flip) ---

// --- createLetterMesh - Final Aspect Ratio Fix Attempt ---
// --- createLetterMesh - Corrected UV Calculation ---
function createLetterMesh(char, color /* THREE.Color */) {
    const charData = charUVData[char] || charUVData['?'];
    if (!charData) {
        console.warn(`Character "${char}" missing from charUVData.`);
        return null;
    }

    const atlasWidth = atlasTexture.image.width;
    const atlasHeight = atlasTexture.image.height;

    // --- Geometry Size (Keep using glyphWidth/FONT_SIZE) ---
    const planeWidth = charData.glyphWidth;
    const planeHeight = FONT_SIZE; // Assuming this visually matches the glyph height on atlas

    // --- UV Calculation (Mapping the GLYPH portion of the atlas block) ---
    const blockX = charData.x;
    const blockY = charData.y;
    const blockWidth = charData.width;   // Includes padding + stroke
    const blockHeight = charData.height; // Includes padding + stroke

    const glyphWidth = charData.glyphWidth; // The actual measured width

    // Calculate horizontal offset of the glyph within its block on the atlas
    // Assumes glyph was centered within the block (padding + stroke on both sides)
    const horizontalPaddingAndStroke = (blockWidth - glyphWidth);
    const glyphAtlasX = blockX + horizontalPaddingAndStroke / 2;

    // Calculate vertical offset (Approximate - assumes glyph centered vertically)
    // We use FONT_SIZE as the target visual height.
    const verticalPaddingAndStroke = (blockHeight - FONT_SIZE); // Estimate padding/stroke around the FONT_SIZE box
    const glyphAtlasY = blockY + verticalPaddingAndStroke / 2;

    // Calculate UV coordinates targeting only the glyph area
    const uMin = glyphAtlasX / atlasWidth;
    const uMax = (glyphAtlasX + glyphWidth) / atlasWidth;
    const vMin = glyphAtlasY / atlasHeight; // Top edge of glyph box on atlas
    const vMax = (glyphAtlasY + FONT_SIZE) / atlasHeight; // Bottom edge of glyph box on atlas

    // --- Geometry Creation ---
    const geometry = new THREE.BufferGeometry();

    // Vertices remain centered around (0,0) using planeWidth/planeHeight
    const positions = new Float32Array([
        -planeWidth / 2, -planeHeight / 2, 0,  // bottom left (0)
         planeWidth / 2, -planeHeight / 2, 0,  // bottom right (1)
        -planeWidth / 2,  planeHeight / 2, 0,  // top left (2)
         planeWidth / 2,  planeHeight / 2, 0   // top right (3)
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Use the newly calculated UVs that target the glyph area
    // const uvs = new Float32Array([
    //     uMin, vMax, // Vertex 0 (Bottom Left) -> uMin
    //     uMax, vMax, // Vertex 1 (Bottom Right) -> uMax
    //     uMin, vMin, // Vertex 2 (Top Left) -> uMin
    //     uMax, vMin  // Vertex 3 (Top Right) -> uMax
    // ]);
    // // --- OR --- Try without V-flip if atlas/texture setup differs
    const uvs = new Float32Array([
        uMin, vMin, // bottom left (0)
        uMax, vMin, // bottom right (1)
        uMin, vMax, // top left (2)
        uMax, vMax  // top right (3)
    ]);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // Indices remain the same
    geometry.setIndex([0, 2, 1, 2, 3, 1]); // BL, TL, BR | TL, TR, BR

    // Vertex colors (Remain the same)
    const colors = new Float32Array(positions.length);
    for (let i = 0; i < 4; i++) {
        colors[i*3 + 0] = color.r;
        colors[i*3 + 1] = color.g;
        colors[i*3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geometry, atlasMaterial);
    mesh.userData.glyphWidth = charData.glyphWidth; // Store original glyph width

    return mesh;
}
// --- Modified cleanupLyric (Doesn't dispose shared material/texture) ---
function cleanupLyric(lyric) {
    if (!lyric || !lyric.threeGroup || lyric.disposed) return;

    lyric.letterMeshes.forEach(mesh => {
        lyric.threeGroup.remove(mesh);
        // Only dispose geometry, as material/texture are shared
        mesh.geometry?.dispose();
    });
    lyric.letterMeshes = []; // Clear the array

    scene.remove(lyric.threeGroup);
    lyric.threeGroup = null; // Release reference
    lyric.disposed = true;
    lyric.inactiveTimestamp = null; // Reset timestamp
    // console.log("Cleaned up lyric:", lyric.id);
}


// --- Update Logic (Handles Visibility, Targets, and Cleanup Trigger) ---
// ... (updateActiveLyricsThreeJS remains largely the same, using performance.now() is better than Date.now()) ...
function updateActiveLyricsThreeJS(currentTimeSeconds) {
    const currentTimeMs = currentTimeSeconds * 1000;
    const fadeInTime = 70; // ms before start time to be active (for fade-in)
    const fadeOutTime = 70; // ms after end time to be active (for fade-out)
    const cleanupDelay = 100; // ms after becoming inactive to dispose

    lyrics.forEach(lyric => {
        if (lyric.disposed) return;

        const wasActive = lyric.active;

        // Determine active state based on current time and fade zones
        const isInFadeInZone = (currentTimeMs >= lyric.startTime - fadeInTime && currentTimeMs < lyric.startTime);
        const isInActiveZone = (currentTimeMs >= lyric.startTime && currentTimeMs <= lyric.endTime);
        const isInFadeOutZone = (currentTimeMs > lyric.endTime && currentTimeMs <= lyric.endTime + fadeOutTime);

        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;

        // Handle visibility and initial positioning
        if (lyric.threeGroup) {
            lyric.threeGroup.visible = lyric.active; // Make group visible/invisible

            if (lyric.active && !wasActive) {
                // Just became active: Reset position/target if needed (or reuse existing logic)
                // The random positioning happens in parseSRT/createLyricObjects now
                // Ensure current position starts away for the lerp-in effect
                lyric.currentX = lyric.targetX + (Math.random() - 0.5) * 10; // Add slight random offset from target
                lyric.currentY = lyric.targetY + (Math.random() - 0.5) * 10;
                lyric.currentZ = lyric.targetZ - 30; // Start further back
                lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

                // Reset letter positions/rotations for entry animation
                lyric.letterMeshes.forEach(mesh => {
                    mesh.position.set(mesh.userData.initialX, mesh.userData.initialY, mesh.userData.initialZ);
                    mesh.rotation.set(
                        THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                        THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                        THREE.MathUtils.randFloatSpread(Math.PI * 0.25)
                    );
                    mesh.scale.set(lyric.baseScale, lyric.baseScale, lyric.baseScale); // Reset scale initially
                });

                // Clear previous inactive timestamp if it reactivates
                lyric.inactiveTimestamp = null;
            }
        }

        // Handle cleanup trigger
        if (!lyric.active && wasActive && lyric.threeGroup) {
            // Just became inactive: record timestamp
            if (lyric.inactiveTimestamp === null) {
                 lyric.inactiveTimestamp = performance.now();
            }
        }

        // Check if cleanup delay has passed
        if (!lyric.active && lyric.inactiveTimestamp !== null && (performance.now() - lyric.inactiveTimestamp > cleanupDelay)) {
            cleanupLyric(lyric);
        }
    });
}


// --- Apply Letter Scaling ---
// ... (applyLetterScaling remains the same conceptually, but uses baseScale from lyric) ...
function applyLetterScaling(letterMesh, audioLevel, baseScale = 1.0) {
    // Using Local Vectors temporarily until global reuse is confirmed safe
    const localTempVecA = new THREE.Vector3();
    const localTempVecB = new THREE.Vector3();

    if (!letterMesh || !letterMesh.parent || !letterMesh.geometry) return; // Basic checks
    letterMesh.updateWorldMatrix(true, false); // Ensure world matrix is up-to-date

    const letterPosition = localTempVecB;
    letterMesh.getWorldPosition(letterPosition); // Get world position of the letter

    // Check for valid positions
    if (isNaN(mouseWorldPosition.x) || isNaN(letterPosition.x)) {
        // console.warn("Invalid position for scaling calculation.");
        return;
    }

    const distanceSq = letterPosition.distanceToSquared(mouseWorldPosition);
    const maxDistance = 150; // Interaction radius
    const maxDistanceSq = maxDistance * maxDistance;
    // Dynamically adjust max scale based on audio, ensure min scale provides visibility
    const maxScaleFactor = 1.6 + audioLevel * 0.6;
    const minScaleFactor = 0.7; // Minimum scale when far away

    let dynamicScaleFactor;
    if (distanceSq < maxDistanceSq) {
        const distance = Math.sqrt(distanceSq);
        // Use a non-linear curve (e.g., quadratic) for smoother scaling near the center
        const t = 1.0 - (distance / maxDistance); // Linear 0 (far) to 1 (close)
        dynamicScaleFactor = minScaleFactor + (maxScaleFactor - minScaleFactor) * t * t; // Quadratic falloff
    } else {
        dynamicScaleFactor = minScaleFactor; // Apply min scale if outside range
    }

    // Combine base scale (from line fitting) with dynamic scale
    const finalScale = baseScale * dynamicScaleFactor; // Use the passed baseScale
    const targetScaleVec = localTempVecA;
    targetScaleVec.set(finalScale, finalScale, finalScale);

    // Lerp towards the target scale for smooth animation
    if (!isNaN(targetScaleVec.x)) {
        letterMesh.scale.lerp(targetScaleVec, 0.15);
    } else {
        const fallbackScaleVec = localTempVecA;
        fallbackScaleVec.set(baseScale, baseScale, baseScale); // Fallback uses baseScale
        letterMesh.scale.lerp(fallbackScaleVec, 0.15);
    }
}


// --- Animation Loop ---
// ... (animate loop remains largely the same, calls new update/scaling functions) ...
function animate() {
    requestAnimationFrame(animate);
    if(stats) stats.update(); // Update FPS counter if stats exist

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    const currentPlaybackTime = getCurrentPlaybackTime();

    // --- Calculate Average Active Lyric Z for Interaction Plane ---
    let activeZSum = 0;
    let activeCount = 0;
    lyrics.forEach(lyric => {
        if (lyric.active && !lyric.disposed && lyric.threeGroup) {
             // Use the group's current Z position for a more accurate average
            activeZSum += lyric.threeGroup.position.z;
            activeCount++;
        }
    });
    if (activeCount > 0) {
        averageActiveLyricZ = activeZSum / activeCount;
    } else {
        averageActiveLyricZ = -150; // Fallback if no lyrics are active
    }
    // ---

    let audioLevel = 0, bass = 0, mid = 0, treble = 0;
    updateActiveLyricsThreeJS(currentPlaybackTime); // Update lyric state (visibility, cleanup)

    // --- Audio Analysis ---
    if (analyser && (sound?.isPlaying || !audioPaused)) {
         if (analyser && (sound?.isPlaying || !audioPaused)) {
            try {
                // --- Use FFT_SIZE / 2 directly ---
                const expectedBinCount = (FFT_SIZE / 2); // Calculate the expected value
   
                // Ensure freqData array is correctly sized (optional but good practice)
                // Note: getFrequencyData might already create the correct size array internally
                // let freqData = analyser.data; // Access the internal array if needed
                // if (!freqData || freqData.length !== expectedBinCount) {
                //    analyser.data = new Uint8Array(expectedBinCount); // Ensure internal array exists
                //    console.warn("Re-initialized analyser data array");
                // }
                const freqData = analyser.getFrequencyData(); // Get frequency data
   
                // Check if the returned array length matches expectations
                if (freqData.length !== expectedBinCount) {
                    console.warn(`Warning: freqData length (${freqData.length}) doesn't match expected bin count (${expectedBinCount})! Calculations might be off.`);
                    // You might want to return or use freqData.length instead below if this happens
                }
                // console.log("Raw Freq Data (first 110 bins):", freqData.slice(0, 110));
   
   
                const nyquist = listener.context.sampleRate / 2;
                // --- Use expectedBinCount for freqPerBin ---
                const freqPerBin = nyquist / expectedBinCount;
                // console.log(`Analyser: ExpectedBinCount=${expectedBinCount}, FreqPerBin=${freqPerBin.toFixed(2)} Hz`);
   
   
                const bassCutoff = 150;
                const midCutoff = 1500;
                const trebleCutoff = 5000;
   
                // --- Use expectedBinCount for index calculations ---
                const bassEndIndex = Math.min(expectedBinCount, Math.floor(bassCutoff / freqPerBin));
                const midEndIndex = Math.min(expectedBinCount, Math.floor(midCutoff / freqPerBin));
                const trebleEndIndex = Math.min(expectedBinCount, Math.floor(trebleCutoff / freqPerBin));
                // console.log(`Calculated Indices: BassEnd=${bassEndIndex}, MidEnd=${midEndIndex}, TrebleEnd=${trebleEndIndex}`);
   
   
                // Bass calculation (loop should now run correctly)
                let bassSum = 0;
                for (let i = 1; i < bassEndIndex; i++) {
                   bassSum += freqData[i] || 0;
                }
                // console.log(`Sums (Before Norm): bassSum=${bassSum}`);
                bass = (bassSum / (bassEndIndex - 1 || 1) / 255.0) * 1.5;
   
                // Mid calculation (loop should now run correctly)
                let midSum = 0;
                for (let i = bassEndIndex; i < midEndIndex; i++) {
                    midSum += freqData[i] || 0;
                }
                // console.log(`Sums (Before Norm): midSum=${midSum}`);
                mid = (midSum / (midEndIndex - bassEndIndex || 1) / 255.0) * 1.5;
   
                // Treble calculation (loop should now run correctly)
                let trebleSum = 0;
                for (let i = midEndIndex; i < trebleEndIndex; i++) {
                    trebleSum += freqData[i] || 0;
                }
                // console.log(`Sums (Before Norm): trebleSum=${trebleSum}`);
                treble = (trebleSum / (trebleEndIndex - midEndIndex || 1) / 255.0) * 1.5;
   
                // Overall Level calculation
                const avgFreq = analyser.getAverageFrequency() / 255.0;
                const peakBand = Math.max(bass, mid, treble);
                audioLevel = Math.min(1.0, (peakBand * 0.6 + avgFreq * 0.4) * 0.88);
   
                // Final log
                // console.log(`Audio Levels: L=${audioLevel.toFixed(2)}, B=${bass.toFixed(2)}, M=${mid.toFixed(2)}, T=${treble.toFixed(2)}, Avg=${(avgFreq * 1.2).toFixed(2)}`);
   
            } catch(e) {
                 console.error("Audio analysis error:", e);
                 audioLevel = 0; bass = 0; mid = 0; treble = 0;
            }
        }

    } else {
        // Fallback animation when audio is paused/off
        audioLevel = Math.abs(Math.sin(elapsedTime * 1.5)) * 0.3; // Quieter fallback
        bass = mid = treble = audioLevel;
    }
    // Ensure values are numbers
     audioLevel = isNaN(audioLevel) ? 0 : audioLevel;
     bass = isNaN(bass) ? 0 : bass;
     mid = isNaN(mid) ? 0 : mid;
     treble = isNaN(treble) ? 0 : treble;
    // ---

    // Update Camera (uses gyro or mouse based on useGyro flag)
    updateCamera(deltaTime, audioLevel, bass, elapsedTime);

    // --- Update visible lyric objects ---
    lyrics.forEach(lyric => {
        if (lyric.active && lyric.threeGroup && !lyric.disposed) {
            // Lerp group position towards target
            const groupMoveSpeed = 0.06; // Adjust for desired group movement speed
            lyric.currentX = THREE.MathUtils.lerp(lyric.currentX, lyric.targetX, groupMoveSpeed);
            lyric.currentY = THREE.MathUtils.lerp(lyric.currentY, lyric.targetY, groupMoveSpeed);
            lyric.currentZ = THREE.MathUtils.lerp(lyric.currentZ, lyric.targetZ, groupMoveSpeed);
            lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

            // Update individual letters within the group
            lyric.letterMeshes.forEach((mesh) => {
                // Lerp letter position towards its target within the group
                const letterMoveSpeed = 0.15; // Faster animation for letters settling
                 _tempVec3_b.set(mesh.userData.targetX, mesh.userData.targetY, mesh.userData.targetZ); // Use temp vector B
                mesh.position.lerp( _tempVec3_b, letterMoveSpeed );

                // Slerp letter rotation towards target (0,0,0)
                const letterRotSpeed = 0.15;
                _tempEuler.set(mesh.userData.targetRotX, mesh.userData.targetRotY, mesh.userData.targetRotZ); // <<< CORRECTED: Use targetRotZ
                _tempQuat.setFromEuler(_tempEuler);
                mesh.quaternion.slerp(_tempQuat, letterRotSpeed);

                // Apply dynamic scaling based on interaction and audio
                // Pass the lyric's baseScale calculated during creation
                applyLetterScaling(mesh, audioLevel, lyric.baseScale);
            });
        }
    });
    // ---
    
    // === PING-PONG RENDERING (Using Clone for Safety + Quad Copy) ===
    if (!renderer || !renderTargetA || !renderTargetB || !feedbackShader || !glitchShader || !copyMaterial || !copyQuad || !quadScene || !quadCamera) {
        // Fallback: Render scene directly if post-processing isn't ready
        if(renderer && scene && camera) {
           renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera);
        }
        return; // Skip post-processing if essential components are missing
   }

   // --- Pass 1: Render Scene ---
   // Render the main scene into Render Target A
   renderer.setRenderTarget(renderTargetA);
   renderer.setClearAlpha(0.0);
   renderer.clear();
   renderer.render(scene, camera); // Result: A = Current Scene

   // --- Pass 2: Feedback ---
   // Read: A (Current Scene via tDiffuse), B (Previous Frame's Feedback via prevFrame)
   // Write: tempFeedbackTarget (A CLONE of B to ensure separation)
   const tempFeedbackTarget = renderTargetB.clone(); // Clone B to write feedback into

   feedbackShader.uniforms.tDiffuse.value = renderTargetA.texture;
   feedbackShader.uniforms.prevFrame.value = renderTargetB.texture; // Read from original B
   feedbackShader.uniforms.time.value = elapsedTime;
   feedbackShader.uniforms.audioLevel.value = audioLevel;
   feedbackShader.uniforms.feedbackAmount.value = THREE.MathUtils.lerp(0.85, 0.95, audioLevel * 0.12);

   quadScene.clear();
   quadScene.add(feedbackQuad);

   renderer.setRenderTarget(tempFeedbackTarget); // Write feedback result to the CLONE
   renderer.clear();
   renderer.render(quadScene, quadCamera); // Result: tempFeedbackTarget = New Feedback Output

   // --- Pass 3: Glitch & Output ---
   // Read: tempFeedbackTarget (New Feedback Output via tDiffuse)
   // Write: Screen (null target)
   glitchShader.uniforms.tDiffuse.value = tempFeedbackTarget.texture; // Read from the CLONE
   glitchShader.uniforms.time.value = elapsedTime;
   glitchShader.uniforms.audioLevel.value = audioLevel;
   glitchShader.uniforms.intensity.value = THREE.MathUtils.lerp(0.02, 0.35, bass * 1.2);
//    glitchShader.uniforms.intensity.value = 0.0;

   quadScene.clear();
   quadScene.add(outputQuad);

   renderer.setRenderTarget(null); // Render final result to screen
   renderer.clear();
   renderer.render(quadScene, quadCamera);

   // --- Prepare for Next Frame: Copy tempFeedbackTarget -> renderTargetB ---
   // Set the texture FROM the temporary target onto the copy material
   copyMaterial.map = tempFeedbackTarget.texture;

   quadScene.clear(); // Clear scene (remove glitch quad)
   quadScene.add(copyQuad); // Add the copy quad

   renderer.setRenderTarget(renderTargetB); // Set render destination to B
   renderer.clear();
   renderer.render(quadScene, quadCamera); // Render the quad, effectively copying the texture

   // --- Cleanup ---
   copyMaterial.map = null; // Remove texture reference from copy material
   tempFeedbackTarget.dispose(); // IMPORTANT: Clean up the cloned target

   // No swap needed. B now holds the latest feedback result for the next frame.
   // A holds the scene render, which will be overwritten next frame.
   // === END PING-PONG ===
}


// --- Camera Update (Handles Gyro OR Mouse/Touch) ---
// ... (updateCamera remains the same) ...
function updateCamera(deltaTime, audioLevel, bassLevel, elapsedTime) {
    // --- Distance ---
    const baseDistance = 250;
    // Make distance more reactive to bass, less to overall level
    const audioDistanceFactor = (bassLevel * 0.7 + audioLevel * 0.3) * 60;
    const targetDistance = baseDistance - audioDistanceFactor;
    // Use a temporary vector for the target position calculation
    const targetPosition = _tempVec3_b.copy(camera.position).normalize().multiplyScalar(targetDistance);
    camera.position.lerp(targetPosition, 0.08); // Lerp towards target distance


    // --- Rotation ---
    let horizontalAngle = 0;
    let verticalAngle = 0;
    const rotationSensitivity = 0.0025; // Mouse sensitivity
    const gyroSensitivityYaw = 1.8;    // Gyro horizontal sensitivity
    const gyroSensitivityPitch = 1.8;  // Gyro vertical sensitivity

    if (useGyro) {
        // Use smoothed gyro data (targetDeviceYaw/Pitch are lerped in handleDeviceOrientation)
        // Apply sensitivity
        horizontalAngle = targetDeviceYaw * gyroSensitivityYaw; // Already inverted in handler
        verticalAngle = targetDevicePitch * gyroSensitivityPitch;

        // Optional Roll (applied to camera.up) - can be disorienting
        // const rollAngle = targetDeviceRoll * 0.5; // Adjust sensitivity
        // camera.up.set(0, 1, 0).applyAxisAngle(_tempVec3.set(0, 0, 1), rollAngle);

    } else { // Use Mouse/Touch Data
        let targetX, targetY;
        // Smoothly follow mouse/touch if interacting, otherwise drift slightly
        if (isInteracting) {
            targetX = targetMouseX;
            targetY = targetMouseY;
        } else {
            // Gentle drifting animation when idle
            const time = elapsedTime * 0.4; // Slower drift
            targetX = Math.sin(time * 0.7) * windowHalfX * 0.08; // Reduced amplitude
            targetY = Math.cos(time * 0.5) * windowHalfY * 0.08;
        }

        // Different lerp factors for active interaction vs. idle drift
        const lerpFactor = isInteracting ? 0.1 : 0.04;
        mouseX = THREE.MathUtils.lerp(mouseX, targetX, lerpFactor);
        mouseY = THREE.MathUtils.lerp(mouseY, targetY, lerpFactor);

        horizontalAngle = -mouseX * rotationSensitivity; // Invert X for natural control
        verticalAngle = -mouseY * rotationSensitivity;   // Invert Y for natural control
    }

    // --- Apply Rotation ---
    // Clamp vertical angle to prevent flipping over
    const maxVerticalAngle = Math.PI * 0.45; // Limit to slightly less than 90 degrees
    const clampedVerticalAngle = THREE.MathUtils.clamp(verticalAngle, -maxVerticalAngle, maxVerticalAngle);

    // Calculate new position based on angles and current distance
    // Use spherical coordinates calculation relative to origin (0,0,0)
    const currentDistance = camera.position.length(); // Maintain lerped distance
    const position = _tempVec3; // Reuse main temp vector

    // Calculate position from spherical coordinates
    position.x = currentDistance * Math.sin(horizontalAngle) * Math.cos(clampedVerticalAngle);
    position.y = currentDistance * Math.sin(clampedVerticalAngle);
    position.z = currentDistance * Math.cos(horizontalAngle) * Math.cos(clampedVerticalAngle);

    // Set final position and look at origin
    camera.position.copy(position);
    camera.lookAt(0, 0, 0); // Always look at the center

    // Ensure camera.up is reset if not using roll from gyro
    if (!useGyro /* || !useRoll */) {
        camera.up.set(0, 1, 0);
    }
}


// --- Event Handlers ---
// ... (onWindowResize remains the same, ensures post-processing targets resize) ...
function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    windowHalfX = width / 2;
    windowHalfY = height / 2;

    aspectRatio = width / height; // Update aspect ratio
    camera.aspect = aspectRatio;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);

    // Recalculate viewport world dimensions used for layout/positioning
    updateViewportDimensions();

    // Resize post-processing targets considering resolution scale
    const pixelRatio = renderer.getPixelRatio();
    const targetWidth = Math.floor(width * pixelRatio * resolutionScale);
    const targetHeight = Math.floor(height * pixelRatio * resolutionScale);

    renderTargetA?.setSize(targetWidth, targetHeight);
    renderTargetB?.setSize(targetWidth, targetHeight);

     console.log(`Resized renderer to ${width}x${height}, post-processing targets to ${targetWidth}x${targetHeight}`);

     // OPTIONAL: Re-create lyric objects if aspect ratio changes significantly?
     // This might be disruptive. Usually scaling handles it okay.
     // if (srtLoaded && atlasMaterial) {
     //     lyrics.forEach(cleanupLyric); // Dispose old ones
     //     lyrics = parseSRT(cachedSrtText); // Re-parse (need to cache srtText)
     //     createLyricObjects(); // Re-create with new viewport dimensions
     // }
}


// --- Run ---
init();