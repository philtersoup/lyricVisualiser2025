// Main visualization code

// Shader variables
let glitchShader;
let feedbackShader;
let mainGraphics;
let feedbackGraphics;
let glitchIntensity = 2.5;
let feedbackBuffer; // NEW: Additional buffer for multi-pass feedback

// Add these variables for effect control
let feedbackStrength = 1.92; // Base feedback amount
let feedbackRGBSplit = 0.6; // RGB splitting in feedback 
let glitchStrength = 0.5; // Base multiplier for glitch effects
let scanlineCount = 10; // Number of scanlines

// Audio variables
let song;
let fft;
let lyrics = [];
let srtContent;
let srtLoaded = false;
let customFont;
let currentLyric = null;

// 3D variables
let effectChoice = 0;

// 3D space parameters - using smaller values to keep letters more centered
let spaceWidth = 800;
let spaceHeight = 600;
let spaceDepth = 1200;

// Camera parameters - positioned to look at center
let cameraX = 0;
let cameraY = 0;
let cameraZ = 550;  // Closer to see letters better
let lookAtX = 0;    // Always looking at center
let lookAtY = 0;
let lookAtZ = 0;    // Look at Z=0 plane where letters will be

// Add these variables to the top of your file with other global variables
let mouseInfluenceX = 0;
let mouseInfluenceY = 0;
let isInteracting = false;
let lastInteractionTime = 0;
let interactionTimeout = 2000; // How long interaction effects persist in ms

// 3D letter container
let letters3D = [];

function preload() {
    // Load custom font
    customFont = loadFont('Blackout Midnight.ttf');
    
    // Load song
    song = loadSound('Vessels_Masterv3_4824.mp3');
    
    // Load SRT file from server
    loadStrings('lyrics.srt', function(result) {
        srtContent = result.join('\n');
        srtLoaded = true;
    });
}

function setup() {
    // Create canvas inside the container
    let canvas = createCanvas(windowWidth, windowHeight, WEBGL);
    canvas.parent('visualizer-container');
    
    // Initialize graphics buffers for shader effects
    mainGraphics = createGraphics(width, height, WEBGL);
    feedbackGraphics = createGraphics(width, height, WEBGL);
    feedbackBuffer = createGraphics(width, height, WEBGL); // NEW: Additional buffer
    
    // Initialize shaders
    glitchShader = createShader(glitchVertexShader, glitchFragmentShader);
    feedbackShader = createShader(feedbackVertexShader, feedbackFragmentShader);
    
    // Set up audio analyzer
    fft = new p5.FFT(0.8, 1024);  // Smoother analysis with higher smoothing and more bands
    
    // Set text properties
    mainGraphics.textFont(customFont);
    mainGraphics.textAlign(CENTER, CENTER);
    
    // IMPORTANT: Enable depth sorting but disable depth testing to prevent clipping
    mainGraphics.setAttributes('antialias', true);
    mainGraphics._renderer.drawingContext.disable(mainGraphics._renderer.drawingContext.DEPTH_TEST);
    
    // For trails effect - set blend mode for better trail visibility
    mainGraphics.blendMode(BLEND);

    // Parse SRT content if loaded
    if (srtLoaded && srtContent) {
        lyrics = parseSRT(srtContent);
        console.log("SRT parsed, found " + lyrics.length + " entries");
    }
    
    // Initialize 3D space for letters
    randomizeLyricPositions3D();
    
    // Setup controls
    document.getElementById('play-btn').addEventListener('click', function() {
        if (song && !song.isPlaying()) {
            song.play();
        }
    });
    
    document.getElementById('pause-btn').addEventListener('click', function() {
        if (song && song.isPlaying()) {
            song.pause();
        }
    });
}

function randomizeLyricPositions3D() {
    for (let lyric of lyrics) {
        // Give each lyric a position that's not too centered
        // Use a wider range of positions but still within camera view
        lyric.targetX = random(-150, 150);
        lyric.targetY = random(-100, 100);
        lyric.targetZ = random(-250, -50);  // Keep in front of camera
        
        // Add some rotation for interest
        lyric.rotX = random(-0.2, 0.2);
        lyric.rotY = random(-0.2, 0.2);
        lyric.rotZ = random(-0.2, 0.2);
        
        // Initialize position if not already set
        if (!lyric.x && !lyric.y && !lyric.z) {
            lyric.x = lyric.targetX;
            lyric.y = lyric.targetY;
            lyric.z = lyric.targetZ;
        }
        
        // Create 3D letter objects
        let charArray = lyric.text.split('');
        
        // Create a simple formation for the letters - just a straight line with good spacing
        lyric.letters3D = charArray.map((char, index) => {
            // Calculate spacing based on font size
            const spacing = lyric.size * 0.9;
            const totalWidth = spacing * (charArray.length - 1);
            const startX = -totalWidth / 2;
            
            return {
                char: char,
                x: random(-100, 100),  // Start scattered
                y: random(-200, 200),
                z: random(-300, -100),
                targetX: startX + (index * spacing),  // Properly spaced line
                targetY: 0,
                targetZ: 0,
                rotX: random(TWO_PI),
                rotY: random(TWO_PI),
                rotZ: random(TWO_PI),
                size: lyric.size,
                color: lyric.color,
                speed: random(0.05, 0.1),
                active: false,
                amplitude: random(5, 15)
            };
        });
    }
}

function updateCamera(audioLevel) {
    // Check if mouse is currently moving
    if (mouseX !== pmouseX || mouseY !== pmouseY) {
      isInteracting = true;
      lastInteractionTime = millis();
    }
    // Check if interaction has timed out
    else if (isInteracting && millis() - lastInteractionTime > interactionTimeout) {
      isInteracting = false;
    }
    
    // Normalize mouse position to -1 to 1 range
    let targetMouseX = (mouseX / width) * 2 - 1;
    let targetMouseY = (mouseY / height) * 2 - 1;
    
    // Smoothly move toward target mouse influence
    mouseInfluenceX = lerp(mouseInfluenceX, targetMouseX, 0.05);
    mouseInfluenceY = lerp(mouseInfluenceY, targetMouseY, 0.05);
    
    // Calculate base camera sway from audio
    let cameraSwayX = sin(frameCount * 0.01) * 5 * audioLevel;
    let cameraSwayY = cos(frameCount * 0.015) * 3 * audioLevel;
    let cameraSwayZ = sin(frameCount * 0.007) * 17 * audioLevel;
    
    // Add mouse/touch influence
    let interactionStrength = isInteracting ? 1.0 : max(0, 1 - (millis() - lastInteractionTime) / interactionTimeout);
    
    // Calculate final camera position
    let finalCameraX = cameraX + cameraSwayX + (mouseInfluenceX * 500 * interactionStrength);
    let finalCameraY = cameraY + cameraSwayY + (mouseInfluenceY * 500 * interactionStrength);
    let finalCameraZ = cameraZ + cameraSwayZ;
    
    // Calculate lookAt point - also influenced by mouse/touch but less dramatically
    let finalLookAtX = lookAtX + (mouseInfluenceX * 20 * interactionStrength);
    let finalLookAtY = lookAtY + (mouseInfluenceY * 15 * interactionStrength);
    
    // Position the camera
    mainGraphics.camera(
      finalCameraX,
      finalCameraY,
      finalCameraZ,
      finalLookAtX, finalLookAtY, lookAtZ,
      0, 1, 0
    );
  }
 
function touchMoved() {
    isInteracting = true;
    lastInteractionTime = millis();
    return false; // prevents default behavior like scrolling
}

function draw() {
    // Save current frame for feedback
    feedbackBuffer.image(feedbackGraphics, -width/2, -height/2);
    feedbackGraphics.image(mainGraphics, -width/2, -height/2);
    
    // Analyze audio if playing
    let audioLevel = 0;
    let bass = 0, mid = 0, treble = 0;
    if (song && song.isPlaying()) {
        fft.analyze();
        bass = fft.getEnergy("bass") / 255.0;
        mid = fft.getEnergy("mid") / 255.0;
        treble = fft.getEnergy("treble") / 255.0;
        audioLevel = (bass + mid * 0.8 + treble * 0.6) / 3.0;
        
        // Update which lyrics are active based on current time
        if (srtLoaded) {
            updateActiveLyrics(song.currentTime() * 1000);
        } else {
            // If no SRT, cycle through lyrics every 2 seconds
            const currentIndex = floor((millis() / 2000) % lyrics.length);
            for (let i = 0; i < lyrics.length; i++) {
                lyrics[i].active = (i === currentIndex);
            }
        }
         // Dynamic adjustment of effects based on audio
        // Increase feedback and glitch during high energy parts
        feedbackStrength = 0.92 + (audioLevel * 0.07); // 0.92-0.99 range
        glitchStrength = 1.0 + (audioLevel * bass * 2.5); // Extra emphasis on bass
        
        // Adjust scanlines based on mid frequencies
        scanlineCount = 10 + (mid * 100); // 100-200 range
    } else {
        // When not playing, activate first lyric
        if (lyrics.length > 0) {
            lyrics[0].active = true;
            for (let i = 1; i < lyrics.length; i++) {
                lyrics[i].active = false;
            }
        }
        
        // Animate audioLevel for preview mode
        audioLevel = sin(millis() * 0.001) * 0.5 + 0.5;
    }
    
    // Clear main graphics for new frame WITH VERY LOW OPACITY for trails
    // This is the key to the trail effect - a barely visible background
    // mainGraphics.background(Math.pow(bass, 4) * 100, mid * 10, treble * 30, 0);  // Very low opacity
    mainGraphics.push();
    mainGraphics.noStroke();
    mainGraphics.fill(Math.pow(bass, 4) * 100, mid * 10, treble * 30, 15); // Very low opacity
    mainGraphics.rectMode(CORNER);
    mainGraphics.translate(-width/2, -height/2, 0);
    mainGraphics.rect(0, 0, width, height);
    mainGraphics.pop();
    
    // Set the camera perspective - use perspective() instead of ortho() for more natural 3D
    mainGraphics.perspective(PI/3, width/height, 10, 2000);
    
    // Camera slightly moves/breathes based on audio - more subtle
    // let cameraSwayX = sin(frameCount * 0.01) * 5 * audioLevel;
    // let cameraSwayY = cos(frameCount * 0.015) * 3 * audioLevel;
    // let cameraSwayZ = sin(frameCount * 0.007) * 7 * audioLevel;
    
    // // Position the camera - always facing center
    // mainGraphics.camera(
    //     cameraX + cameraSwayX, 
    //     cameraY + cameraSwayY, 
    //     cameraZ + cameraSwayZ,
    //     lookAtX, lookAtY, lookAtZ,
    //     0, 1, 0
    // );
    updateCamera(audioLevel);
    
    // Add ambient light
    mainGraphics.ambientLight(100, 100, 100);
    
    // Add directed light that pulses with the audio
    mainGraphics.directionalLight(
        200 + bass * 55, 
        180 + mid * 75, 
        160 + treble * 95, 
        sin(frameCount * 0.02), 
        cos(frameCount * 0.02), 
        -1
    );
    
    // Draw 3D lyrics
    draw3DLyrics(mainGraphics, bass, mid, treble, audioLevel);
    
    // If a high energy moment, trigger effect change
    if (audioLevel > 0.65 && frameCount % 60 === 0) {
        effectChoice = Math.floor(random(0, 5));
    }
    
    // Apply enhanced feedback shader for main view
    shader(feedbackShader);
    feedbackShader.setUniform('prevFrame', feedbackGraphics);
    feedbackShader.setUniform('currentFrame', mainGraphics);
    feedbackShader.setUniform('feedbackAmount', feedbackStrength);
    feedbackShader.setUniform('time', millis() * 0.001);
    rect(-width/2, -height/2, width, height);
    
    // Apply enhanced glitch shader for final output
    shader(glitchShader);
    glitchShader.setUniform('tex0', mainGraphics);
    glitchShader.setUniform('time', millis() * 0.001);
    glitchShader.setUniform('intensity', Math.pow(audioLevel, 2.5) * glitchIntensity * glitchStrength);
    glitchShader.setUniform('audioLevel', audioLevel);
    rect(-width/2, -height/2, width, height);
}

function draw3DLyrics(graphics, bass, mid, treble, audioLevel) {
    graphics.push();
    
    // Draw each active lyric in 3D space
    for (let lyric of lyrics) {
        if (!lyric.active) continue;
        
        // Move lyric toward target position
        lyric.x = lerp(lyric.x, lyric.targetX, 0.05);
        lyric.y = lerp(lyric.y, lyric.targetY, 0.05);
        lyric.z = lerp(lyric.z, lyric.targetZ, 0.05);
        
        graphics.push();
        
        // Position the lyric in 3D space with slight audio-reactive movement
        let wordSway = sin(frameCount * 0.02) * 5 * audioLevel;
        let wordBob = cos(frameCount * 0.03) * 3 * audioLevel;
        graphics.translate(lyric.x + wordSway, lyric.y + wordBob, lyric.z);
        
        // Apply subtle rotation to the whole lyric
        graphics.rotateX(lyric.rotX * frameCount * 0.0005);
        graphics.rotateY(lyric.rotY * frameCount * 0.0005);
        graphics.rotateZ(lyric.rotZ * frameCount * 0.0005);
        
        // Update letter positions - simple wave motion
        for (let i = 0; i < lyric.letters3D.length; i++) {
            const letter = lyric.letters3D[i];
            letter.active = lyric.active;
            
            // Add some wave motion to the letters
            letter.targetY += sin((frameCount + i * 4) * 0.05) * letter.amplitude * audioLevel * 0.5;
            
            // Move letters to their positions
            letter.x = lerp(letter.x, letter.targetX, letter.speed * 2.0);
            letter.y = lerp(letter.y, letter.targetY, letter.speed * 2.0);
            letter.z = lerp(letter.z, letter.targetZ, letter.speed * 2.0);
            
            // Gradually stabilize rotation
            letter.rotX = lerp(letter.rotX, 0, 0.1);
            letter.rotY = lerp(letter.rotY, 0, 0.1);
            letter.rotZ = lerp(letter.rotZ, 0, 0.1);
            
            // Reset targetY after applying to prevent accumulation
            letter.targetY = 0;
        }
        
        // Draw letters in back-to-front order for proper depth rendering
        let renderOrder = [...lyric.letters3D].map((letter, index) => ({letter, index}))
                                             .sort((a, b) => b.letter.z - a.letter.z);
        
        // Draw each letter in depth-sorted order
        for (let item of renderOrder) {
            const letter = item.letter;
            drawLetter3D(graphics, letter, bass, mid, treble, audioLevel);
        }
        
        graphics.pop();
    }
    
    graphics.pop();
}


function updateLetterPositions(letter, index, totalLetters, audioLevel, effectType) {
    // Calculate spacing based on total letters to keep centered
    let spacing = 25;  // Increased base spacing
    if (totalLetters > 15) {
        spacing = 350 / totalLetters;  // Adjust spacing for long texts
    }
    
    // Store the original index to maintain letter order
    letter.originalIndex = index;
    
    // Declare angle variable at the beginning to avoid reference errors
    let angle = 0;
    let radius = 0;
    
    // Update letter movement based on effect type - keeping all formations centered
    switch (effectType) {
        case 0: // Line formation (similar to 2D original)
            letter.targetX = (index - totalLetters/2) * spacing;
            letter.targetY = sin((frameCount + index * 4) * 0.05) * letter.amplitude * audioLevel * 0.5; // Reduced oscillation
            letter.targetZ = 0;
            break;
            
        case 1: // Circle formation - centered
            angle = map(index, 0, totalLetters, 0, TWO_PI);
            radius = 80 + sin(frameCount * 0.03) * 10 * audioLevel; // Smaller radius, slower movement
            letter.targetX = cos(angle) * radius;
            letter.targetY = sin(angle) * radius;
            letter.targetZ = 0;
            break;
            
        case 2: // Wave formation - centered
            letter.targetX = (index - totalLetters/2) * spacing;
            letter.targetY = sin(frameCount * 0.03 + index * 0.2) * 20 * (1 + audioLevel * 0.5); // Reduced amplitude
            letter.targetZ = cos(frameCount * 0.03 + index * 0.2) * 20 * (1 + audioLevel * 0.5); // Reduced amplitude
            break;
            
        case 3: // 3D helix - centered along Z axis
            angle = map(index, 0, totalLetters, 0, TWO_PI * 1.5);
            radius = 50; // Smaller radius
            letter.targetX = cos(angle + frameCount * 0.005) * radius;  // Slower rotation
            letter.targetY = sin(angle + frameCount * 0.005) * radius;
            letter.targetZ = (index - totalLetters/2) * 8; // Reduced Z spread
            break;
            
        case 4: // Pulsing grid - still centered
            let cols = ceil(sqrt(totalLetters));
            let row = floor(index / cols);
            let col = index % cols;
            let gridSize = min(width, height) * 0.2; // Smaller grid
            let cellSize = gridSize / max(cols, 1);
            
            letter.targetX = (col - cols/2 + 0.5) * cellSize;
            letter.targetY = (row - cols/2 + 0.5) * cellSize;
            letter.targetZ = sin(frameCount * 0.03 + index * 0.1) * 20 * audioLevel; // Reduced Z movement
            break;
    }
    
    // Faster movement to target position - helps keep letters on screen
    letter.x = lerp(letter.x, letter.targetX, letter.speed * 2.0);
    letter.y = lerp(letter.y, letter.targetY, letter.speed * 2.0);
    letter.z = lerp(letter.z, letter.targetZ, letter.speed * 2.0);
    
    // Significantly reduced rotation - letters stay more upright
    letter.rotX = lerp(letter.rotX, 0, 0.1);  // Gradually revert to 0 rotation
    letter.rotY = lerp(letter.rotY, 0, 0.1);
    letter.rotZ = lerp(letter.rotZ, 0, 0.1);
}

function drawLetter3D(graphics, letter, bass, mid, treble, audioLevel) {
    if (letter.char === ' ') return; // Skip rendering spaces
    
    graphics.push();
    
    // Position the letter
    graphics.translate(letter.x, letter.y, letter.z);
    
    // Apply minimal rotation for stability
    graphics.rotateX(letter.rotX * 0.2);  // Very minimal rotation
    graphics.rotateY(letter.rotY * 0.2);
    graphics.rotateZ(letter.rotZ * 0.2);
    
    // Very minimal audio reactive sizing - much more subtle
    let sizeMod = 1.5;
    if (letter.char === 'A' || letter.char === 'E' || letter.char === 'I' || letter.char === 'O' || letter.char === 'U') {
        sizeMod += bass * 0.15; // Reduced from 0.2
    } else if (letter.char === ' ') {
        sizeMod += mid * 0.05; // Reduced from 0.1
    } else {
        sizeMod += treble * 0.1; // Reduced from 0.15
    }
    
    // Create a color for the letter with some audio reactivity - brighter colors
    let r = min(255, red(color(letter.color)) + bass * 80);
    let g = min(255, green(color(letter.color)) + mid * 80);
    let b = min(255, blue(color(letter.color)) + treble * 80);
    
    // Add minimal pulsing based on audio
    let pulseFactor = 1 + sin(frameCount * 0.08) * 0.05 * audioLevel; // Reduced from 0.1
    
    // Draw the actual 3D letter
    graphics.push();
    graphics.scale(sizeMod * pulseFactor * 0.95); // Keep small scale
    
    // Set text properties
    graphics.textSize(letter.size);
    graphics.textAlign(CENTER, CENTER);
    
    // Create manual stroke effect by drawing the text multiple times in red
    let strokeWeight = 4; // Adjust for thicker/thinner stroke
    let strokeColor = color(255, 0, 0); // Pure red stroke

    // First draw the stroke by drawing the text multiple times with slight offsets
    graphics.fill(red(strokeColor), green(strokeColor), blue(strokeColor));
    // Draw multiple offset copies to create outline effect
    for (let i = -strokeWeight; i <= strokeWeight; i += strokeWeight) {
        for (let j = -strokeWeight; j <= strokeWeight; j += strokeWeight) {
            if (i === 0 && j === 0) continue; // Skip the center position
            graphics.text(letter.char, i, j, 0);
        }
    }

    // Then draw the main letter on top
    graphics.fill(r, g, b, 255);  // Original fill color
    graphics.text(letter.char, 0, 0, 0);
    
    // Optional: Draw extruded sides for more 3D feel
    let depth = 1 + audioLevel * 5; // Reduced from 10 + audioLevel * 10
    
    // Draw back face (slightly darker)
    graphics.push();
    graphics.translate(0, 0, -depth);
    
    // Add stroke to the back face too
    graphics.fill(red(strokeColor) * 0.7, green(strokeColor) * 0.7, blue(strokeColor) * 0.7);
    for (let i = -strokeWeight; i <= strokeWeight; i += strokeWeight) {
        for (let j = -strokeWeight; j <= strokeWeight; j += strokeWeight) {
            if (i === 0 && j === 0) continue;
            graphics.text(letter.char, i, j, 0);
        }
    }
    
    // Then the fill
    graphics.fill(r * 0.7, g * 0.7, b * 0.7, 255);
    graphics.text(letter.char, 0, 0, 0);
    
    graphics.pop();
    
    graphics.pop();
    graphics.pop();
}

function updateActiveLyrics(currentTime) {
    // Transition variables
    const fadeInTime = 150; // ms
    const fadeOutTime = 150; // ms
    
    for (let lyric of lyrics) {
        const wasActive = lyric.active;
        
        // Add fade in/out buffer to make transitions smoother
        const isInFadeInZone = (currentTime >= lyric.startTime - fadeInTime && currentTime < lyric.startTime);
        const isInActiveZone = (currentTime >= lyric.startTime && currentTime <= lyric.endTime);
        const isInFadeOutZone = (currentTime > lyric.endTime && currentTime <= lyric.endTime + fadeOutTime);
        
        // Set active based on time including transition zones
        lyric.active = isInFadeInZone || isInActiveZone || isInFadeOutZone;
        
        if (lyric.active && !wasActive) {
            // When a lyric becomes active, give it a position away from the center
            lyric.targetX = random(-150, 150); 
            lyric.targetY = random(-100, 100);
            lyric.targetZ = random(-250, -50);
            
            // Reset letter positions for a clean entrance
            for (let letter of lyric.letters3D) {
                // Start letters scattered for a dramatic entrance
                letter.x = random(-300, 300);
                letter.y = random(-200, 200);
                letter.z = random(-400, -200);
                
                // Fresh random rotation
                letter.rotX = random(TWO_PI);
                letter.rotY = random(TWO_PI);
                letter.rotZ = random(TWO_PI);
                
                // Faster movement during entrance
                letter.speed = random(0.05, 0.1);
            }
        }
    }
}


function parseSRT(srtContent) {
    const parsedLyrics = [];
    const blocks = srtContent.trim().split('\n\n');
    
    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.length < 3) continue;
        
        // Extract the time codes (format: 00:00:00,000 --> 00:00:00,000)
        const timeCode = lines[1];
        const times = timeCode.split(' --> ');
        
        if (times.length !== 2) continue;
        
        // Convert timestamps to milliseconds
        const startTime = timeToMilliseconds(times[0]);
        const endTime = timeToMilliseconds(times[1]);
        
        // Get all text lines (may be multiple lines per subtitle)
        const text = lines.slice(2).join(' ');
        
        // Generate brighter, more saturated colors for better visibility
        const randomColor = getBrightColor();
        
        parsedLyrics.push({
            text: text,
            startTime: startTime,
            endTime: endTime,
            active: false,
            color: randomColor,
            size: random(40, 70), // Slightly smaller size range for legibility
            x: 0,
            y: 0,
            z: 0,
            targetX: 0,  // Start centered
            targetY: 0,
            targetZ: 0,
            rotX: random(-0.1, 0.1),  // Smaller rotation values
            rotY: random(-0.1, 0.1),
            rotZ: random(-0.1, 0.1),
            speed: random(0.05, 0.1),
            letters3D: []  // Will be populated in randomizeLyricPositions3D
        });
    }
    
    return parsedLyrics;
}

function timeToMilliseconds(timeString) {
    // Format: 00:00:00,000 or 00:00:00.000
    timeString = timeString.replace(',', '.');
    const [time, milliseconds] = timeString.split('.');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + parseInt(milliseconds);
}

function getBrightColor() {
    // Brighter, more saturated colors for better visibility
    const colors = [
        "#FF5733", // Bright Red-Orange
        "#33FFF5", // Bright Cyan
        "#FFFC33", // Bright Yellow
        "#FF33F5", // Bright Pink
        "#33FF57", // Bright Green
        "#5733FF", // Bright Blue-Purple
        "#FF3366", // Bright Pink-Red
        "#66FF33", // Bright Lime
        "#33BBFF", // Bright Sky Blue
        "#FF9933"  // Bright Orange
    ];
    return colors[Math.floor(random(colors.length))];
}

// Handle window resizing
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    mainGraphics.resizeCanvas(width, height);
    feedbackGraphics.resizeCanvas(width, height);
    feedbackBuffer.resizeCanvas(width, height); // Add this line
}