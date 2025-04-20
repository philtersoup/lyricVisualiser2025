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
let composer; // Note: We aren't using the EffectComposer from 'three/addons' in the final ping-pong logic, but keep imports if needed elsewhere.
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

// Animation / Timing
const clock = new THREE.Clock();
// Custom audio playback tracking
let audioStartTimestamp = 0;
let audioPaused = true;
let audioOffset = 0;

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
let cameraStartX = 0; // Not used in current orbit logic, but keep if needed
let cameraStartY = 0;
let cameraStartZ = 0;

const raycaster = new THREE.Raycaster();
const mouse3D = new THREE.Vector2(); // Normalized mouse position (-1 to 1)
const mousePlaneZ = -150; // Z-plane where mouse interaction occurs (can be adjusted)
const mouseWorldPosition = new THREE.Vector3(); // 3D position in world space for scaling

let viewportWorldWidth = 0;
let viewportWorldHeight = 0;
let aspectRatio = 1;

// --- Shader Paths (ADJUST THESE TO YOUR ACTUAL FILES) ---
const FEEDBACK_VERTEX_PATH = '/shaders/feedback.vert.glsl';
const FEEDBACK_FRAGMENT_PATH = '/shaders/feedback.frag.glsl';
const GLITCH_VERTEX_PATH = '/shaders/glitch.vert.glsl';
const GLITCH_FRAGMENT_PATH = '/shaders/glitch.frag.glsl';

// --- Constants ---
const FONT_SIZE = 50; // Base font size
let FONT_FACE = 'sans-serif'; // Default fallback
const FONT_FILE_PATH = 'Blackout Midnight.ttf'; // Path to your font file
const FONT_FAMILY_NAME = 'Blackout Midnight'; // Name to reference the font with
const LETTER_COLOR = '#FFFFFF'; // Default letter color (overridden by random color)
const LETTER_SPACING_FACTOR = 0.1; // Adjusts space between letters
const STROKE_WIDTH = 8; // Thickness of the letter outline
const STROKE_COLOR = 'red'; // Color of the letter outline

// Flag to track font loading status
let customFontLoaded = false;

// --- Utility Functions ---

function updateMouse3DPosition(event) {
    mouse3D.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse3D.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse3D, camera);
    const planeNormal = new THREE.Vector3(0, 0, 1);
    // Adjust plane constant based on camera Z, keep interaction plane relative
    const planeConstant = -(camera.position.z + mousePlaneZ); 
    const plane = new THREE.Plane(planeNormal, planeConstant);
    raycaster.ray.intersectPlane(plane, mouseWorldPosition);
    // Fallback if intersectPlane fails (e.g., ray parallel to plane)
    if (!mouseWorldPosition || isNaN(mouseWorldPosition.x)) {
       mouseWorldPosition.set(0,0, camera.position.z + mousePlaneZ); // Place it on the plane directly in front
    }
}

function updateViewportDimensions() {
    if (!camera) return;
    const fov = camera.fov * (Math.PI / 180);
    const zDepth = -150; // Reference Z-depth for positioning calculations
    const distance = Math.abs(zDepth - camera.position.z);
    viewportWorldHeight = 2 * Math.tan(fov / 2) * distance;
    aspectRatio = window.innerWidth / window.innerHeight;
    viewportWorldWidth = viewportWorldHeight * aspectRatio;
    // console.log(`Viewport at Z=${zDepth}: ${viewportWorldWidth.toFixed(2)} x ${viewportWorldHeight.toFixed(2)}`);
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
        // Ensure playback time doesn't go below offset (can happen with tiny timing variations)
        return Math.max(audioOffset, audioOffset + elapsedSinceStart);
    }
}

// --- Interaction Setup ---
function setupInteraction() {
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('mouseup', onDocumentMouseUp);
    document.addEventListener('touchstart', onDocumentTouchStart, { passive: false });
    document.addEventListener('touchmove', onDocumentTouchMove, { passive: false });
    document.addEventListener('touchend', onDocumentTouchEnd);
    console.log("Mouse/touch interaction setup complete");
}

function onDocumentMouseMove(event) {
    targetMouseX = (event.clientX - windowHalfX); // Store raw pixel offset
    targetMouseY = (event.clientY - windowHalfY);
    updateMouse3DPosition(event);
}

function onDocumentMouseDown(event) {
    isInteracting = true;
    // Store initial mouse/touch position relative to center for delta calculation
    touchStartX = event.clientX - windowHalfX;
    touchStartY = event.clientY - windowHalfY;
    // Raw mouseX/Y are now based on delta, so reset target to current
    targetMouseX = touchStartX;
    targetMouseY = touchStartY;
    mouseX = targetMouseX; // Snap immediately
    mouseY = targetMouseY;
}

function onDocumentMouseUp() {
    isInteracting = false;
    // Keep targetMouseX/Y where they are for smooth transition to idle animation
}

function onDocumentTouchStart(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        isInteracting = true;
        // Store initial touch position relative to center
        touchStartX = event.touches[0].pageX - windowHalfX;
        touchStartY = event.touches[0].pageY - windowHalfY;
        targetMouseX = touchStartX;
        targetMouseY = touchStartY;
        mouseX = targetMouseX; // Snap immediately
        mouseY = targetMouseY;

        // Update 3D position for initial touch
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchMove(event) {
    if (event.touches.length === 1) {
        event.preventDefault();
        const touchX = event.touches[0].pageX - windowHalfX;
        const touchY = event.touches[0].pageY - windowHalfY;

        // Update target based on current touch position
        targetMouseX = touchX;
        targetMouseY = touchY;

        // Update 3D position
        updateMouse3DPosition({ clientX: event.touches[0].pageX, clientY: event.touches[0].pageY });
    }
}

function onDocumentTouchEnd() {
    isInteracting = false;
    // Keep targetMouseX/Y where they are
}

// --- Font Loading ---
async function loadCustomFont() {
    try {
        console.log(`Loading custom font from: ${FONT_FILE_PATH}`);
        const encodedFontFileName = encodeURIComponent(FONT_FILE_PATH); // Encode only the filename part
        const fontFace = new FontFace(
            FONT_FAMILY_NAME,
            `url('${encodedFontFileName}') format('truetype')` // Use encoded filename in URL
        );
        const loadedFont = await fontFace.load();
        document.fonts.add(loadedFont);
        FONT_FACE = FONT_FAMILY_NAME; // Use the loaded font family name
        customFontLoaded = true;
        console.log(`Custom font "${FONT_FAMILY_NAME}" loaded successfully`);
        return true;
    } catch (error) {
        console.error('Error loading custom font:', error);
        console.log('Falling back to default font:', FONT_FACE);
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

// --- Audio Setup & Controls ---
function setupAudio() {
    return new Promise((resolve, reject) => { // Wrap in promise for async init
        listener = new THREE.AudioListener();
        camera.add(listener); // Add listener to camera
        sound = new THREE.Audio(listener);
        audioLoader = new THREE.AudioLoader();

        audioLoader.load('Vessels_Masterv3_4824.mp3',
            // Success
            buffer => {
                sound.setBuffer(buffer);
                sound.setVolume(0.5);
                // sound.setLoop(true); // Optional: Loop audio
                analyser = new THREE.AudioAnalyser(sound, FFT_SIZE);
                console.log("Audio loaded and analyzer created");
                resolve(buffer); // Resolve the promise
            },
            // Progress
            progress => {
                console.log(`Audio loading: ${Math.round(progress.loaded / progress.total * 100)}%`);
            },
            // Error
            error => {
                console.error('Error loading audio:', error);
                reject(error); // Reject the promise
            }
        );
    });
}

function setupControls() {
    const playButton = document.getElementById('play-btn');
    const pauseButton = document.getElementById('pause-btn');

    async function handlePlayAudio() {
        try {
            console.log("Play button pressed, context state:", listener.context.state);
            if (listener.context.state === 'suspended') {
                await listener.context.resume();
                console.log("AudioContext resumed.");
            }

            if (sound && sound.buffer && listener.context.state === 'running') {
                 // Use setTimeout only if strictly needed, often direct play works after resume
                // setTimeout(() => { 
                    if (!sound.isPlaying) {
                        // Calculate offset - start from beginning or resume from pause point
                        sound.offset = audioOffset; 
                        sound.play();
                        // Recalculate start timestamp based on current time and offset
                        audioStartTimestamp = performance.now() / 1000 - audioOffset; 
                        audioPaused = false;
                        console.log(`Playing audio: offset=${audioOffset.toFixed(3)}s, timestamp=${audioStartTimestamp.toFixed(3)}s`);
                    } else {
                        console.log("Audio already playing.");
                    }
                // }, 50); // Reduced or removed delay
            } else {
                 console.warn("Cannot play audio - check sound buffer and context state:", { buffer: !!sound?.buffer, state: listener.context.state });
            }
        } catch (err) {
            console.error("Error in handlePlayAudio:", err);
        }
    }

    function handlePauseAudio() {
        try {
            if (sound && sound.isPlaying) {
                // Calculate current playback time *before* pausing
                audioOffset = getCurrentPlaybackTime(); 
                sound.pause(); // Pause stops internal clock
                audioPaused = true;
                console.log("Paused at offset:", audioOffset.toFixed(3));
            } else {
                 console.warn("Cannot pause: sound is not playing.");
            }
        } catch (err) {
            console.error("Error during pause:", err);
        }
    }

    playButton.addEventListener('click', handlePlayAudio);
    playButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePlayAudio(); });
    pauseButton.addEventListener('click', handlePauseAudio);
    pauseButton.addEventListener('touchend', (e) => { e.preventDefault(); handlePauseAudio(); });

    setupiOSAudioUnlock();
}

function setupiOSAudioUnlock() {
    console.log("Setting up iOS audio unlock handlers");
    const unlockAudio = async () => {
        if (!listener || !listener.context || listener.context.state !== 'suspended') {
            return; // Only proceed if suspended
        }
        try {
            await listener.context.resume();
            console.log("Audio context unlocked via user gesture.");
            // Play silent buffer to ensure unlock persists
            const buffer = listener.context.createBuffer(1, 1, 22050);
            const source = listener.context.createBufferSource();
            source.buffer = buffer;
            source.connect(listener.context.destination);
            source.start(0);
            source.stop(listener.context.currentTime + 0.001);
             console.log("Silent buffer played.");
        } catch (error) {
            console.error("Failed to unlock audio context:", error);
        }
    };
    // Use 'pointerdown' for broader compatibility (touch/mouse)
    document.addEventListener('pointerdown', unlockAudio, { once: true }); 
}

// --- Initialization ---
async function init() {
    console.log("init() called");
    
    scene = new THREE.Scene();

    aspectRatio = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspectRatio, 1, 2000); // Adjusted near plane
    camera.position.set(0, 0, 300); // Start distance
    camera.lookAt(scene.position);
    
    updateViewportDimensions(); // Initial calculation
    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    // Load font first
    await loadCustomFont(); 

    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        preserveDrawingBuffer: true // Needed for feedback source
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; // Crucial for manual render passes
    document.getElementById('visualizer-container').appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(0.5, 1, -0.5); // Adjust light direction
    scene.add(directionalLight);

    setupInteraction(); // Setup mouse/touch listeners

    console.log("Starting asset loading...");
    // Use Promise.allSettled for robust loading
    const [shadersResult, audioResult, srtResult] = await Promise.allSettled([
        loadShaders(),
        setupAudio(), // setupAudio now returns a promise
        fetch('lyrics.srt').then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.text();
        })
    ]);

    let shaderCode;
    if (shadersResult.status === 'fulfilled') {
        shaderCode = shadersResult.value;
    } else {
        console.error("FATAL: Failed to load shaders!", shadersResult.reason);
        // Optionally display an error message to the user here
        return; // Stop initialization if shaders fail
    }

    if (audioResult.status === 'fulfilled') {
        console.log("Audio setup completed successfully.");
    } else {
        console.error('Audio setup failed:', audioResult.reason);
        // Audio failure might be acceptable, continue but analyser won't work
    }

    if (srtResult.status === 'fulfilled') {
        lyrics = parseSRT(srtResult.value);
        srtLoaded = true;
        console.log("SRT parsed, found " + lyrics.length + " entries");
        createLyricObjects(); // Create objects only after SRT is loaded
    } else {
        console.error("Error loading or parsing SRT:", srtResult.reason);
        // Allow proceeding without lyrics, or display an error
    }
    console.log("Asset loading finished.");

    // Setup post-processing using loaded shaders
    setupPostProcessing(shaderCode); 

    setupControls(); // Setup play/pause buttons

    window.addEventListener('resize', onWindowResize);

    console.log("Starting animation loop...");
    animate();
}

// --- Post-Processing Setup ---
function setupPostProcessing(shaderCode) {
    console.log("Setting up ping-pong feedback post-processing...");
    
    const targetOptions = { 
        minFilter: THREE.LinearFilter, 
        magFilter: THREE.LinearFilter, 
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType, // Standard type
        stencilBuffer: false // Usually not needed for post-processing
    };
    
    const pixelRatio = renderer.getPixelRatio();
    const width = Math.floor(window.innerWidth * pixelRatio);
    const height = Math.floor(window.innerHeight * pixelRatio);
    
    renderTargetA = new THREE.WebGLRenderTarget(width, height, targetOptions);
    renderTargetB = new THREE.WebGLRenderTarget(width, height, targetOptions);
    
    quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quadScene = new THREE.Scene();
    
    feedbackShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },    // Current frame (scene rendered to A)
            prevFrame: { value: null },   // Previous feedback result (from B)
            feedbackAmount: { value: 0.8 },
            time: { value: 0.0 },
            audioLevel: { value: 0.0 }
        },
        vertexShader: shaderCode.feedbackVS,
        fragmentShader: shaderCode.feedbackFS,
        depthTest: false,
        depthWrite: false
    });
    
    glitchShader = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },    // Input from feedback pass
            intensity: { value: 0.1 }, // Base intensity
            time: { value: 0.0 },
            audioLevel: { value: 0.0 }
        },
        vertexShader: shaderCode.glitchVS,
        fragmentShader: shaderCode.glitchFS,
        depthTest: false,
        depthWrite: false
    });
    
    feedbackQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), feedbackShader);
    outputQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), glitchShader);
    
    console.log("Post-processing setup complete.");
}

// --- SRT Parsing ---
// --- SRT Parsing (with Line Splitting, Corrected Stacking, and Split Flag) ---
function parseSRT(srtContent) {
    const parsedLyrics = []; // Array to hold the final lyric objects
    const blocks = srtContent.trim().split('\n\n'); // Split SRT into time blocks

    // --- Configuration ---
    // Maximum characters before attempting to split a line.
    // ** Tune this value based on testing on target mobile devices! **
    const MAX_LINE_LENGTH = 10; 
    // Vertical distance between stacked lines (adjust multiplier if needed)
    const LINE_STACKING_OFFSET = FONT_SIZE * 1.1; // Using 1.1 based on previous adjustment

    // --- Process each SRT block ---
    for (const block of blocks) {
        const lines = block.split('\n'); // Split block into lines (index, time, text...)
        // Basic validation: Need at least index, time, and one line of text
        if (lines.length < 3) continue; 

        const timeCode = lines[1]; // Get the timecode line

        // --- Timing Extraction ---
        const times = timeCode.split(' --> '); // Define 'times' array
        if (times.length !== 2) continue; // Validate format
        const startTime = timeToMilliseconds(times[0]); 
        const endTime = timeToMilliseconds(times[1]);   
        // --- End Timing Extraction ---

        const originalText = lines.slice(2).join(' '); 
        const randomColor = getBrightColor(); 

        let textParts = [originalText]; // Start with the original text
        let wasSplit = false; // *** ADD FLAG to track if splitting occurred ***

        // --- Automatic Line Splitting Logic ---
        if (originalText.length > MAX_LINE_LENGTH) {
            let remainingText = originalText;
            let potentialParts = []; 
            let safetyBreak = 0; 

            while (remainingText.length > MAX_LINE_LENGTH && safetyBreak < 5) { 
                 safetyBreak++;
                 let splitIndex = -1; 
                 const idealSplitPoint = MAX_LINE_LENGTH; 
                 const searchRadius = 10; 

                 // Search backwards for a space
                 for (let i = idealSplitPoint; i >= idealSplitPoint - searchRadius && i > 0; i--) {
                     if (remainingText[i] === ' ') { splitIndex = i; break; }
                 }
                 // If not found, search forwards
                 if (splitIndex === -1) {
                      for (let i = idealSplitPoint + 1; i < idealSplitPoint + searchRadius && i < remainingText.length; i++) {
                         if (remainingText[i] === ' ') { splitIndex = i; break; }
                     }
                 }
                 // If still no space, force break
                 if (splitIndex === -1) { splitIndex = MAX_LINE_LENGTH; }

                 potentialParts.push(remainingText.substring(0, splitIndex).trim());
                 remainingText = remainingText.substring(splitIndex).trim();

                 if (remainingText.length <= MAX_LINE_LENGTH) {
                     potentialParts.push(remainingText);
                     remainingText = ""; 
                     break; 
                 }
            } 
            if(remainingText.length > 0) { potentialParts.push(remainingText); }

            // If splitting happened, update textParts and set the flag
            if (potentialParts.length > 1) {
                textParts = potentialParts; 
                wasSplit = true; // *** SET FLAG ***
                // console.log(`Split line at ${startTime}ms into ${textParts.length} parts:`, textParts);
            }
        } // --- End Line Splitting Logic ---

        // --- Create Lyric Objects for each Text Part ---
        const partCount = textParts.length; 
        const baseInitialPos = randomPositionInViewport(
            -0.2, 0.2,  // Tighter X range
            -0.15, 0.15, // Tighter Y range 
            -180, -90   // Tighter Z range
        );
        const totalHeight = (partCount - 1) * LINE_STACKING_OFFSET;
        const topTargetY = baseInitialPos.y + totalHeight / 2; 

        // Loop through each text part (could be 1 or more) and create a lyric object
        textParts.forEach((textPart, index) => {
            // Calculate the target Y for this specific line
            const lineTargetY = topTargetY - (index * LINE_STACKING_OFFSET);

            parsedLyrics.push({
                id: `${startTime}_${index}`, 
                text: textPart, 
                startTime: startTime, 
                endTime: endTime,     
                active: false,        
                color: randomColor,   
                size: FONT_SIZE,      
                threeGroup: null,     
                letterMeshes: [],     
                targetX: baseInitialPos.x,  
                targetY: lineTargetY,       // Calculated stacked Y
                targetZ: baseInitialPos.z,
                currentX: baseInitialPos.x, 
                currentY: lineTargetY,      // Calculated stacked Y
                currentZ: baseInitialPos.z - 50, // Start further back
                baseScale: 1.0,         
                wasSplit: wasSplit, // *** STORE THE FLAG ***
                disposed: false,            
                inactiveTimestamp: null,    
            });
        }); // End loop through text parts
    } // --- End loop through SRT blocks ---
    
    console.log(`Parsed ${blocks.length} SRT blocks into ${parsedLyrics.length} lyric objects.`);
    return parsedLyrics; // Return the array of processed lyric objects
}
// --- Lyric Object Creation & Cleanup ---
function createLyricObjects() {
    console.log(`Creating lyric objects with font: ${FONT_FACE}`);
    updateViewportDimensions(); // Ensure dimensions are current

    lyrics.forEach(lyric => {
        // Skip if previously created and disposed (e.g., after resize)
        if (lyric.disposed || lyric.threeGroup) return; 

        const lineGroup = new THREE.Group();
        lineGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ); 
        
        const charArray = lyric.text.split('');
        let currentXOffset = 0;
        const meshes = [];
        let totalWidth = 0;
        const spaceWidth = lyric.size * LETTER_SPACING_FACTOR * 0.25;
        
        const letterMeshObjects = [];
        charArray.forEach(char => {
            if (char === ' ') {
                totalWidth += spaceWidth;
            } else {
                // Use lyric's size property
                const letterObj = createLetterMesh(char, lyric.size, lyric.color); 
                letterMeshObjects.push(letterObj);
                totalWidth += letterObj.width;
            }
        });
        // Add spacing between letters
        totalWidth += Math.max(0, charArray.length - 1) * (lyric.size * LETTER_SPACING_FACTOR * 0.3);
        
        // *** ADDITION: Clipping Fix - Calculate and Apply Scale ***
        const maxAllowedWidth = viewportWorldWidth * 0.95; // Use 95% of viewport width
        let scaleFactor = 1.0;
        if (totalWidth > 0 && totalWidth > maxAllowedWidth) { // Avoid division by zero
            scaleFactor = maxAllowedWidth / totalWidth;
            // console.log(`Lyric "${lyric.text.substring(0,10)}..." too wide, scaling by ${scaleFactor.toFixed(2)}`);
        }
        lyric.baseScale = scaleFactor; // Store the calculated base scale
        lineGroup.scale.set(lyric.baseScale, lyric.baseScale, lyric.baseScale);

        // --- Position letters ---
        currentXOffset = -totalWidth / 2; // Center based on original calculated width
        let letterIndex = 0;
        
        charArray.forEach((char, index) => {
            if (char === ' ') {
                currentXOffset += spaceWidth;
                return; // Skip mesh creation for space
            }
            
            const { mesh, width: charWidth } = letterMeshObjects[letterIndex++];
            
            // Final target position within the group (centered layout)
            mesh.userData.targetX = currentXOffset + (charWidth / 2);
            mesh.userData.targetY = 0;
            mesh.userData.targetZ = index * 0.01; // Slight Z offset for overlap

            // *** MODIFICATION: Softer Initial Animation Setup ***
            const initialOffsetMagnitude = 30; // Reduced initial distance
            const randomDirection = new THREE.Vector3(
                Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
            ).normalize().multiplyScalar(initialOffsetMagnitude);

            // Calculate initial position relative to target
            mesh.userData.initialX = mesh.userData.targetX + randomDirection.x;
            mesh.userData.initialY = mesh.userData.targetY + randomDirection.y;
            mesh.userData.initialZ = mesh.userData.targetZ + randomDirection.z + 60; // Start further back/offset Z

            mesh.position.set(mesh.userData.initialX, mesh.userData.initialY, mesh.userData.initialZ);
            
            mesh.userData.targetRotX = 0;
            mesh.userData.targetRotY = 0;
            mesh.userData.targetRotZ = 0;
            
            // Reduced initial random rotation
            mesh.rotation.set(
                THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                THREE.MathUtils.randFloatSpread(Math.PI * 0.5),
                THREE.MathUtils.randFloatSpread(Math.PI * 0.25)
            );
            
            lineGroup.add(mesh);
            meshes.push(mesh);
            
            // Advance position for next character
            currentXOffset += charWidth + (lyric.size * LETTER_SPACING_FACTOR * 0.3);
        });
        
        lyric.threeGroup = lineGroup;
        lyric.letterMeshes = meshes;
        lineGroup.visible = false; // Start invisible
        scene.add(lineGroup); // Add to the main scene
    });
    
    // console.log("Created/updated Three.js objects for lyrics.");
}

function createLetterMesh(char, size, color = LETTER_COLOR) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${size}px ${FONT_FACE}`; // Use loaded font face name
    ctx.font = font;

    const metrics = ctx.measureText(char);
    const textWidth = metrics.width;
    const padding = STROKE_WIDTH * 2; 
    const canvasWidth = THREE.MathUtils.ceilPowerOfTwo(textWidth + padding);
    // Estimate height based on font size, add padding
    const fontHeightEstimate = size * 1.2; 
    const canvasHeight = THREE.MathUtils.ceilPowerOfTwo(fontHeightEstimate + padding);

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Redraw on resized canvas
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    // --- Draw Stroke ---
    ctx.strokeStyle = STROKE_COLOR; 
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineJoin = 'round'; 
    ctx.miterLimit = 2;
    ctx.strokeText(char, centerX, centerY);

    // --- Draw Fill ---
    ctx.fillStyle = color;
    ctx.fillText(char, centerX, centerY);

    // --- Create Three.js Objects ---
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter; // Smoother texture sampling

    // Calculate plane dimensions based on canvas aspect ratio to avoid distortion
    const planeHeight = size * (canvasHeight / fontHeightEstimate); // Scale height proportionally
    const planeWidth = planeHeight * (canvasWidth / canvasHeight); 

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.01, // Adjust alphaTest slightly if needed
        side: THREE.DoubleSide,
        depthWrite: true // Keep true for now, monitor Z-fighting
    });

    const mesh = new THREE.Mesh(geometry, material);
    
    // Return mesh and its calculated *layout* width (used for spacing)
    // Use textWidth for layout to keep spacing consistent regardless of stroke/padding
    return { mesh, width: textWidth }; 
}


function cleanupLyric(lyric) {
    if (!lyric || !lyric.threeGroup || lyric.disposed) return; 

    // console.log(`Cleaning up lyric (ID ${lyric.id}): "${lyric.text.substring(0, 20)}..."`);

    lyric.letterMeshes.forEach(mesh => {
        lyric.threeGroup.remove(mesh); // Remove from parent FIRST is often safer
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose(); 
            mesh.material.dispose();
        }
    });
    lyric.letterMeshes = []; // Clear array

    scene.remove(lyric.threeGroup); // Remove group from scene
    lyric.threeGroup = null; 
    lyric.disposed = true; // Mark as disposed
    lyric.inactiveTimestamp = null;
}

// --- Update Logic ---
// --- Update Logic (Handles Visibility, Targets, and Cleanup Trigger) ---
function updateActiveLyricsThreeJS(currentTimeSeconds) {
    const currentTimeMs = currentTimeSeconds * 1000;
    // Timing for fade in/out zones (relative to SRT times)
    const fadeInTime = 150; 
    const fadeOutTime = 150; 
    // How long to wait after becoming inactive before cleaning up resources
    const cleanupDelay = 5000; 

    lyrics.forEach(lyric => {
        // Skip if this object has already been cleaned up
        if (lyric.disposed) return; 

        const wasActive = lyric.active; // Store previous active state

        // Determine if the lyric should be active based on current time
        const isInFadeInZone = (currentTimeMs >= lyric.startTime - fadeInTime && currentTimeMs < lyric.startTime);
        const isInActiveZone = (currentTimeMs >= lyric.startTime && currentTimeMs <= lyric.endTime);
        const isInFadeOutZone = (currentTimeMs > lyric.endTime && currentTimeMs <= lyric.endTime + fadeOutTime);
        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;
        
        // Update visibility of the Three.js group
        if (lyric.threeGroup) {
            lyric.threeGroup.visible = lyric.active; 
        }
        
        // --- When a lyric *just* becomes active ---
        if (lyric.active && !wasActive) {
            // Get a new random target position (within central bounds)
            const newPos = randomPositionInViewport(
                -0.2, 0.2,    // TIGHT X bounds
                -0.15, 0.15,  // TIGHT Y bounds (This Y is only used if NOT split)
                -180, -90     // TIGHT Z bounds
            );
            
            // Always update Target X and Z for the new appearance location
            lyric.targetX = newPos.x;
            lyric.targetZ = newPos.z;

            // *** FIX: Only update Target Y if it was *not* part of a split line ***
            if (!lyric.wasSplit) { 
                // If it's a single line, assign the random Y target
                lyric.targetY = newPos.y; 
            } 
            // If lyric.wasSplit is true, targetY retains the stacked value 
            // calculated in parseSRT and is NOT overwritten here.

            // --- Set initial Current position slightly away from target --- 
            // This ensures the lerp animation has a visible effect when it appears
            lyric.currentX = lyric.targetX + (Math.random() - 0.5) * 10; // Small random X offset
            
            // Only offset initial Y if it wasn't split. If split, start exactly at calculated Y.
            lyric.currentY = lyric.wasSplit ? lyric.targetY : lyric.targetY + (Math.random() - 0.5) * 10; 
            
            lyric.currentZ = lyric.targetZ - 30; // Start a bit further back for Z animation

            // Apply this initial current position immediately if the group exists
            // (Ensures it doesn't start at the previous position if re-activated quickly)
            if(lyric.threeGroup) { 
                 lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);
                 // Optional: Reset letter positions/rotations here if desired for re-entry effect
            }
        } // --- End block for lyric becoming active ---

        // --- Cleanup Logic Trigger ---
        // If it just became inactive, record the timestamp
        if (!lyric.active && wasActive && lyric.threeGroup) {
            lyric.inactiveTimestamp = performance.now(); 
        }

        // Check if cleanup is due (inactive for long enough)
        if (!lyric.active && lyric.inactiveTimestamp && (performance.now() - lyric.inactiveTimestamp > cleanupDelay)) {
            cleanupLyric(lyric); // Call the cleanup function
        }
        // --- End Cleanup Logic Trigger ---

    }); // End loop through lyrics
}

function applyLetterScaling(letterMesh, audioLevel, baseScale = 1.0) {
     // Ensure mesh and world matrix are valid
    if (!letterMesh || !letterMesh.parent) return;
    letterMesh.updateWorldMatrix(true, false); // Ensure world matrix is up-to-date

    const letterPosition = new THREE.Vector3();
    letterMesh.getWorldPosition(letterPosition);
    
    // Check if mouseWorldPosition is valid
    if (isNaN(mouseWorldPosition.x) || isNaN(letterPosition.x)) return;

    const distance = letterPosition.distanceTo(mouseWorldPosition);
    
    const maxDistance = 150; // Effective range of mouse scaling
    const maxScaleFactor = 2.6 + audioLevel * 0.6; // Max relative scale boost
    const minScaleFactor = 0.7; // Min relative scale reduction
    
    let dynamicScaleFactor;
    if (distance < maxDistance) {
        // Smoother interpolation (e.g., quadratic easing out)
        const t = 1 - (distance / maxDistance);
        dynamicScaleFactor = minScaleFactor + (maxScaleFactor - minScaleFactor) * t * t; 
    } else {
        dynamicScaleFactor = minScaleFactor; 
    }

    const finalScale = baseScale * dynamicScaleFactor;
    
    const targetScaleVec = new THREE.Vector3(finalScale, finalScale, finalScale);
    
    // Safety check for NaN before lerping
    if (!isNaN(targetScaleVec.x) && !isNaN(targetScaleVec.y) && !isNaN(targetScaleVec.z)) {
       // Use slerp for scale? No, lerp is fine. Use faster lerp for scale responsiveness.
       letterMesh.scale.lerp(targetScaleVec, 0.15); 
    } else {
       // Fallback to base scale if calculation failed
       letterMesh.scale.lerp(new THREE.Vector3(baseScale, baseScale, baseScale), 0.15);
    }
}


// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    const currentPlaybackTime = getCurrentPlaybackTime();

    let audioLevel = 0, bass = 0, mid = 0, treble = 0;
    
    // Update Active Lyrics State FIRST
    updateActiveLyricsThreeJS(currentPlaybackTime); 

    // Audio Analysis
    if (analyser && (sound.isPlaying || !audioPaused)) {
        const freqData = analyser.getFrequencyData();
        // Basic frequency band calculation (adjust ranges as needed)
        const bassEnd = Math.floor(FFT_SIZE * 0.08); // Lower bass range
        const midEnd = Math.floor(FFT_SIZE * 0.3);
        const trebleEnd = Math.floor(FFT_SIZE * 0.5); // Use half FFT size

        let bassSum = 0; for (let i = 1; i < bassEnd; i++) bassSum += freqData[i];
        bass = (bassSum / (bassEnd - 1 || 1) / 255.0) * 1.5; // Normalize & boost slightly

        let midSum = 0; for (let i = bassEnd; i < midEnd; i++) midSum += freqData[i];
        mid = (midSum / (midEnd - bassEnd || 1) / 255.0) * 1.5;

        let trebleSum = 0; for (let i = midEnd; i < trebleEnd; i++) trebleSum += freqData[i];
        treble = (trebleSum / (trebleEnd - midEnd || 1) / 255.0) * 1.5;
        
        audioLevel = Math.max(bass, mid, treble) * 0.6 + (analyser.getAverageFrequency() / 255.0) * 0.4; // Weighted average
        audioLevel = Math.min(1.0, audioLevel * 1.2); // Clamp and boost overall level slightly

    } else {
        // Simple preview animation if audio not playing/loaded
        audioLevel = Math.abs(Math.sin(elapsedTime * 1.5)) * 0.6;
        bass = mid = treble = audioLevel;
        // No need to manage lyric visibility here, updateActiveLyrics handles it based on time 0 or paused time
    }
    
    // Update Camera
    updateCamera(deltaTime, audioLevel, bass, elapsedTime);

    // Update visible lyric objects
    lyrics.forEach(lyric => {
        // *** Check if active AND not disposed ***
        if (lyric.active && lyric.threeGroup && !lyric.disposed) { 
            
            // Lerp group position smoothly
            const groupMoveSpeed = 0.06; // Slightly faster group lerp
            lyric.currentX = THREE.MathUtils.lerp(lyric.currentX, lyric.targetX, groupMoveSpeed);
            lyric.currentY = THREE.MathUtils.lerp(lyric.currentY, lyric.targetY, groupMoveSpeed);
            lyric.currentZ = THREE.MathUtils.lerp(lyric.currentZ, lyric.targetZ, groupMoveSpeed);
            lyric.threeGroup.position.set(lyric.currentX, lyric.currentY, lyric.currentZ);

            // Update individual letters
            lyric.letterMeshes.forEach((mesh) => {
                // *** MODIFICATION: Adjusted animation speeds ***
                const letterMoveSpeed = 0.15; // Faster assembly
                const letterRotSpeed = 0.15; // Faster rotation settle

                // Lerp position towards target within the group
                mesh.position.lerp(
                    new THREE.Vector3(mesh.userData.targetX, mesh.userData.targetY, mesh.userData.targetZ),
                    letterMoveSpeed
                );
                
                // Slerp rotation towards target (flat)
                const targetQuaternion = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(mesh.userData.targetRotX, mesh.userData.targetRotY, mesh.userData.targetRotZ)
                );
                mesh.quaternion.slerp(targetQuaternion, letterRotSpeed);
                
                // Apply interactive scaling (passing base scale)
                applyLetterScaling(mesh, audioLevel, lyric.baseScale); 
            });
        }
    });

    // === PING-PONG RENDERING ===
    if (!renderer || !renderTargetA || !renderTargetB || !feedbackShader || !glitchShader || !quadScene || !quadCamera) {
        console.error("Rendering components not ready!");
        return; // Skip rendering if setup isn't complete
    }
    
    // STEP 1: Render main scene (lyrics, etc.) to Target A
    renderer.setRenderTarget(renderTargetA);
    renderer.clear();
    renderer.render(scene, camera);
    
    // STEP 2: Prepare Feedback Pass
    feedbackShader.uniforms.tDiffuse.value = renderTargetA.texture; // Current scene
    feedbackShader.uniforms.prevFrame.value = renderTargetB.texture; // Previous feedback result
    feedbackShader.uniforms.time.value = elapsedTime;
    feedbackShader.uniforms.audioLevel.value = audioLevel;
    // Modulate feedback amount by audio level
    feedbackShader.uniforms.feedbackAmount.value = THREE.MathUtils.lerp(0.65, 0.95, audioLevel * 0.3); 

    // STEP 3: Render Feedback Effect (using Quad) to a Temporary Target
    // Important: Use a *new* temporary target to avoid reading/writing same texture
    const tempTarget = renderTargetA.clone(); // Clone structure/size of A
    quadScene.clear(); // Clear previous quad
    quadScene.add(feedbackQuad); // Add quad with feedback shader
    renderer.setRenderTarget(tempTarget);
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    
    // STEP 4: Prepare Glitch Pass
    glitchShader.uniforms.tDiffuse.value = tempTarget.texture; // Input is feedback result
    glitchShader.uniforms.time.value = elapsedTime;
    glitchShader.uniforms.audioLevel.value = audioLevel;
    // Modulate glitch intensity more strongly by audio
    glitchShader.uniforms.intensity.value = THREE.MathUtils.lerp(0.05, 0.1, audioLevel); 
    
    // STEP 5: Render Glitch Effect (using Quad) to the Screen
    quadScene.clear();
    quadScene.add(outputQuad); // Add quad with glitch shader
    renderer.setRenderTarget(null); // Render to canvas
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    
    // STEP 6: Copy the feedback result (from tempTarget) to Target B for the *next* frame
    // Use a simple copy material for efficiency
    const copyMaterial = new THREE.MeshBasicMaterial({ map: tempTarget.texture });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
    quadScene.clear();
    quadScene.add(copyQuad);
    renderer.setRenderTarget(renderTargetB); // Render into B
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    
    // STEP 7: Cleanup temporary resources for this frame
    renderer.setRenderTarget(null); // Reset render target
    tempTarget.dispose(); // Dispose the temporary render target
    copyMaterial.map = null; // Break reference
    copyMaterial.dispose(); // Dispose the copy material
    // (copyQuad geometry is reused, no need to dispose geometry each frame)

    // The next frame will use renderTargetB as prevFrame input
}

// --- Camera Update ---
// --- Camera Update ---
// *** FIX: Add elapsedTime as a parameter ***
function updateCamera(deltaTime, audioLevel, bassLevel, elapsedTime) { 
    const baseDistance = 150; // Base distance from origin
    // Modulate distance more subtly, primarily based on bass/overall level
    const audioDistanceFactor = (bassLevel * 0.6 + audioLevel * 0.4) * 60; 
    const targetDistance = baseDistance - audioDistanceFactor;
    
    // Smoothly interpolate current distance towards target distance
    camera.position.lerp(
         camera.position.clone().normalize().multiplyScalar(targetDistance), 
         0.08 // Speed of distance change
    );

    // --- Orbit Calculation based on Mouse/Touch Input ---
    let targetX = 0;
    let targetY = 0;

    if (isInteracting) {
        // Use the raw pixel offset directly for orbit control feel
        targetX = targetMouseX; 
        targetY = targetMouseY;
    } else {
        // Gentle idle drift when not interacting
        // *** FIX: elapsedTime is now available here ***
        const time = elapsedTime * 0.5; // Slower drift (Now works!)
        targetX = Math.sin(time * 0.6) * windowHalfX * 0.1; // Drift based on % of window width
        targetY = Math.cos(time * 0.4) * windowHalfY * 0.1;
    }
    
    // Smoothly interpolate the controlling mouse values
    const lerpFactor = isInteracting ? 0.15 : 0.04; // Faster response when interacting
    mouseX = THREE.MathUtils.lerp(mouseX, targetX, lerpFactor);
    mouseY = THREE.MathUtils.lerp(mouseY, targetY, lerpFactor);

    // Define sensitivity (radians per pixel) - smaller value = less sensitive
    const rotationSensitivity = 0.0025; 

    // Calculate angles based on smoothed mouseX/Y values
    // Horizontal angle (around Y axis) - rotates left/right
    const horizontalAngle = -mouseX * rotationSensitivity; 
    // Vertical angle (around X axis) - rotates up/down
    const verticalAngle = -mouseY * rotationSensitivity; 

    // Clamp vertical angle to prevent flipping over
    const maxVerticalAngle = Math.PI * 0.45; // Limit to slightly less than +/- 90 degrees
    const clampedVerticalAngle = THREE.MathUtils.clamp(verticalAngle, -maxVerticalAngle, maxVerticalAngle);

    // Calculate new position using spherical coordinates relative to origin (0,0,0)
    const currentDistance = camera.position.length(); // Use the lerped distance
    const position = new THREE.Vector3();
    
    // Calculate position based on angles (Y-up standard)
    position.x = currentDistance * Math.sin(horizontalAngle) * Math.cos(clampedVerticalAngle);
    position.y = currentDistance * Math.sin(clampedVerticalAngle);
    position.z = currentDistance * Math.cos(horizontalAngle) * Math.cos(clampedVerticalAngle);

    // Apply the calculated position
    camera.position.copy(position);
    
    // Always look at the center
    camera.lookAt(0, 0, 0);
}


// --- Event Handlers ---
function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    windowHalfX = width / 2;
    windowHalfY = height / 2;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Recalculate viewport world dimensions used for positioning/clipping
    updateViewportDimensions(); 

    renderer.setSize(width, height);
    const pixelRatio = renderer.getPixelRatio();
    const targetWidth = Math.floor(width * pixelRatio);
    const targetHeight = Math.floor(height * pixelRatio);

    // Resize post-processing targets
    renderTargetA?.setSize(targetWidth, targetHeight);
    renderTargetB?.setSize(targetWidth, targetHeight);

    // Optional: Re-evaluate clipping for existing lyrics if needed
    // lyrics.forEach(lyric => {
    //     if (lyric.threeGroup && !lyric.disposed) {
    //         // Recalculate totalWidth based on original letters
    //         // Recalculate scaleFactor based on new viewportWorldWidth
    //         // Update lyric.baseScale and lyric.threeGroup.scale
    //     }
    // });
    // console.log("Window resized and components updated.");
}

// --- Run ---
init().catch(err => { 
    console.error("Initialization failed:", err);
    // Display a user-friendly error message on the page if possible
    const container = document.getElementById('visualizer-container');
    if (container) {
        container.innerHTML = `<p style="color: red; padding: 20px;">Error initializing visualizer. Please check console for details.</p>`;
    }
});