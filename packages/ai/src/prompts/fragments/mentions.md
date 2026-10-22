<!-- part: intro -->
The user's latest message mentions these files from the workspace. They are shown as they are now:

<!-- part: inline -->
<workspace-file path="{{path}}">
{{content}}
</workspace-file>

<!-- part: omitted -->
<workspace-file path="{{path}}" omitted="true">{{reason}}</workspace-file>

<!-- part: workspaceOff -->
The workspace is off for this message.

<!-- part: notFound -->
No such file in the workspace.

<!-- part: unreadable -->
The workspace couldn't be read: {{message}}

<!-- part: tooLarge -->
The file is {{size}} bytes, too large to include here. Use the read tool to read it, a range of lines at a time.

<!-- part: notText -->
The file isn't UTF-8 text, so it isn't shown. Inspect it with bash if you need to.

<!-- part: artifact -->
The user picked "{{label}}" in this message: they want a `{{kind}}` artifact. Make it with `create_artifact` (type "{{kind}}") rather than answering in text, then say briefly what you made.
