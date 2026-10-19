---
id: "309"
title: "Prototype: what the chat surface looks like on iPhone, light and dark"
labels: [wayfinder:prototype]
status: open
map: "300"
assignee:
blockedBy: ["316"]
---

## Question

A rough SwiftUI prototype with canned data, run in the simulator, to react to: the chat list (stock), the message column, a streaming reply, a tool status line, an approval card, the composer with model picker and attach button, all in light and dark with Liquid Glass. Where exactly do our overrides sit on stock chrome, and how close to the web's theme (`globals.css` tokens, radius, type) should it read? Compare against ChatGPT and Claude iOS (Mobbin). Race MarkdownView against SwiftStreamingMarkdown on one long streamed reply ([the markdown research](304-swiftui-streaming-markdown.md)). Also show one artifact in a `WKWebView` hosting the artifacts runtime fed by `postMessage`, which [the Swift client research](306-swift-client-stack.md) couldn't test. Output: screenshots plus the list of bespoke components the build needs.
