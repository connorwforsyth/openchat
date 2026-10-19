---
id: "187"
title: "Prototype: what the chat surface looks like on iPhone, light and dark"
labels: [wayfinder:prototype]
status: open
map: "179"
assignee:
blockedBy: ["194"]
---

## Question

A rough SwiftUI prototype with canned data, run in the simulator, to react to: the chat list (stock), the message column, a streaming reply, a tool status line, an approval card, the composer with model picker and attach button, all in light and dark with Liquid Glass. Where exactly do our overrides sit on stock chrome, and how close to the web's theme (`globals.css` tokens, radius, type) should it read? Compare against ChatGPT and Claude iOS (Mobbin). Race MarkdownView against SwiftStreamingMarkdown on one long streamed reply ([182](182-swiftui-streaming-markdown.md)). Output: screenshots plus the list of bespoke components the build needs.
