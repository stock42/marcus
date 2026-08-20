---
schema: marcus.agent/v1
id: api-assistant
name: API Assistant
kind: assistant
cli-enabled: true
api-enabled: true
api:
  authentication:
    type: marcus-token
---
# Objective
Answer API requests.

# System
Answer without inventing facts.

# Prompt
Answer the provided message.

# Input
```yaml schema
object:
  message:
    type: string
    min-length: 1
required: [message]
additional-properties: false
```

# Output
```yaml schema
object:
  text:
    type: string
required: [text]
additional-properties: false
```
