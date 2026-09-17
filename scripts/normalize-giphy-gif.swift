import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: normalize-giphy-gif.swift <frames-directory> <output.gif>")
}

let framesDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let frameURLs = try FileManager.default.contentsOfDirectory(
    at: framesDirectory,
    includingPropertiesForKeys: nil
).filter { $0.pathExtension.lowercased() == "png" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
let frameCount = frameURLs.count

guard frameCount > 1 else {
    fatalError("Expected multiple PNG frames, found \(frameCount)")
}

guard let destination = CGImageDestinationCreateWithURL(
    output as CFURL,
    UTType.gif.identifier as CFString,
    frameCount,
    nil
) else {
    fatalError("Cannot create output GIF at \(output.path)")
}

let containerProperties: CFDictionary = [
    kCGImagePropertyGIFDictionary: [
        kCGImagePropertyGIFLoopCount: 0
    ]
] as CFDictionary
CGImageDestinationSetProperties(destination, containerProperties)

for (index, frameURL) in frameURLs.enumerated() {
    guard
        let frameSource = CGImageSourceCreateWithURL(frameURL as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(frameSource, 0, nil)
    else {
        fatalError("Cannot decode PNG frame \(index)")
    }

    let frameProperties: CFDictionary = [
        kCGImagePropertyGIFDictionary: [
            kCGImagePropertyGIFDelayTime: 0.08,
            kCGImagePropertyGIFUnclampedDelayTime: 0.08
        ]
    ] as CFDictionary
    CGImageDestinationAddImage(destination, image, frameProperties)
}

guard CGImageDestinationFinalize(destination) else {
    fatalError("Failed to finalize normalized GIF")
}

print(output.path)
