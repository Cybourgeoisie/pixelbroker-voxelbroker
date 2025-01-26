const sharp = require('sharp');
const path = require('path');

// Check if image path is provided
if (process.argv.length < 3) {
    console.error('Please provide an image path');
    process.exit(1);
}

const imagePath = process.argv[2];
const NUM_LEVELS = 8; // Number of gray levels we want
const OPACITY_THRESHOLD = 128; // Minimum alpha value (0-255) to consider a pixel opaque

async function processImage(inputPath) {
    try {
        // Load the image
        const image = sharp(inputPath);
        const metadata = await image.metadata();
        
        // Get the raw pixel data
        const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Create a new buffer for the output
        const outputBuffer = Buffer.alloc(data.length);
        
        const width = info.width;
        const height = info.height;
        const channels = info.channels;

        // Helper function to get pixel index
        const getPixelIndex = (x, y) => (y * width + x) * channels;

        // Helper function to check if pixel should be treated as transparent
        const isEffectivelyTransparent = (index) => {
            return channels === 4 && data[index + 3] < OPACITY_THRESHOLD;
        };

        // Helper function to check if a pixel is on an edge (touches transparency)
        const isEdgePixel = (x, y) => {
            // Check all 8 surrounding pixels
            const directions = [
                [-1, -1], [0, -1], [1, -1],
                [-1,  0],          [1,  0],
                [-1,  1], [0,  1], [1,  1]
            ];

            for (const [dx, dy] of directions) {
                const newX = x + dx;
                const newY = y + dy;
                
                // Skip if outside image bounds
                if (newX < 0 || newX >= width || newY < 0 || newY >= height) {
                    continue;
                }

                const neighborIndex = getPixelIndex(newX, newY);
                if (isEffectivelyTransparent(neighborIndex)) {
                    return true;
                }
            }
            return false;
        };

        // First pass: collect all unique colors and calculate their luminance
        const colorMap = new Map();
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = getPixelIndex(x, y);
                
                if (!isEffectivelyTransparent(i)) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const key = `${r},${g},${b}`;
                    
                    // Calculate perceived luminance
                    // Using Rec. 709 coefficients for RGB to luminance conversion
                    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    
                    colorMap.set(key, {
                        r, g, b,
                        luminance
                    });
                }
            }
        }

        // Sort colors by luminance
        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => a[1].luminance - b[1].luminance);

        // Create mapping to new gray levels
        const levelSize = 255 / (NUM_LEVELS - 1);
        const colorToGrayMap = new Map();
        
        sortedColors.forEach(([key, color], index) => {
            // Determine which bin this color belongs in
            const binIndex = Math.min(
                NUM_LEVELS - 1,
                Math.floor((index / (sortedColors.length - 1)) * NUM_LEVELS)
            );
            const grayValue = Math.round(binIndex * levelSize);
            colorToGrayMap.set(key, grayValue);
        });

        // Second pass: apply the mapping to create the output image
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = getPixelIndex(x, y);
                
                if (!isEffectivelyTransparent(i)) {
                    if (isEdgePixel(x, y)) {
                        // Set edge pixels to black
                        outputBuffer[i] = 0;     // R
                        outputBuffer[i + 1] = 0; // G
                        outputBuffer[i + 2] = 0; // B
                    } else {
                        const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
                        const grayValue = colorToGrayMap.get(key);
                        
                        // Set RGB values to the mapped gray value
                        outputBuffer[i] = grayValue;     // R
                        outputBuffer[i + 1] = grayValue; // G
                        outputBuffer[i + 2] = grayValue; // B
                    }
                    
                    // Set alpha to fully opaque for non-transparent pixels
                    if (channels === 4) {
                        outputBuffer[i + 3] = 255;
                    }
                } else {
                    // Make effectively transparent pixels fully transparent
                    outputBuffer[i] = 0;     // R
                    outputBuffer[i + 1] = 0; // G
                    outputBuffer[i + 2] = 0; // B
                    if (channels === 4) {
                        outputBuffer[i + 3] = 0;
                    }
                }
            }
        }

        // Generate output path
        const parsedPath = path.parse(inputPath);
        const outputPath = path.join(
            parsedPath.dir,
            parsedPath.name + '_depth' + parsedPath.ext
        );

        // Save the processed image
        await sharp(outputBuffer, {
            raw: {
                width: width,
                height: height,
                channels: channels
            }
        }).toFile(outputPath);

        console.log(`Processed image saved to: ${outputPath}`);

    } catch (error) {
        console.error('Error processing image:', error);
    }
}

// Process the image
processImage(imagePath);