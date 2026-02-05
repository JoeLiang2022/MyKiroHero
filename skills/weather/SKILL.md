---
name: Weather
description: Query current weather and forecasts for any location
triggers: [weather, 天氣, 氣溫, forecast, 預報, rain, 下雨]
---

# Weather Skill

This skill helps you check weather conditions and forecasts.

## Capabilities

- Current weather for any city
- Multi-day forecasts
- Weather alerts and warnings
- Temperature, humidity, wind speed

## How to Use

When the user asks about weather, use web search to find current weather data for the specified location.

### Example Queries

- "What's the weather in Taipei?"
- "台北今天天氣如何？"
- "Will it rain tomorrow?"
- "明天會下雨嗎？"

## Response Format

Provide weather information in a friendly, conversational way:

- Temperature (Celsius)
- Weather condition (sunny, cloudy, rainy, etc.)
- Humidity percentage
- Any relevant warnings

## Notes

- Default to user's location if not specified (Taiwan/Taipei)
- Use Celsius for temperature
- Include both current conditions and short-term forecast when relevant
