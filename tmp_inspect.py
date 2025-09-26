from pathlib import Path
text = Path("game.js").read_text()
start = text.index("      const up = keys.has('KeyW') ? 1 : 0;")
end = text.index("        if (keys.has('KeyE')) {", start)
end = text.index("      }\n\n", end)
print(text[start:end+7])
