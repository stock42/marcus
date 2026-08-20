---
schema: marcus.agent/v1
id: scheduled-report
name: Scheduled Report
kind: prompt-task
cli-enabled: false
schedules:
  - id: daily-report
    cron: "0 3 * * *"
    timezone: UTC
    input:
      period: daily
recovery:
  policy: restart-instance
  max-restarts: 3
---
# Objective
Create a scheduled report.

# System
Produce the report for the requested period.

# Input
```yaml schema
object:
  period:
    type: string
required: [period]
additional-properties: false
```

# Output
```yaml schema
object:
  report:
    type: string
required: [report]
additional-properties: false
```
