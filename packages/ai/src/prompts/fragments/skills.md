<!-- part: picked -->
The user picked the skill "{{name}}" for this message. Follow its instructions:

<skill name="{{name}}">
{{instructions}}
</skill>

<!-- part: files -->
The skill "{{name}}" bundles these files. Read one with the `{{tool}}` tool, passing the skill's name and the file's path:
{{files}}

<!-- part: available -->
You have these skills. When one fits the task, call the `{{tool}}` tool with its name to read its instructions and the files it bundles, then follow them:
{{skills}}

<!-- part: entry -->
- {{name}}: {{description}}
