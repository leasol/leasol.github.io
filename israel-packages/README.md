# סטודיו החבילות הישראליות

כלי אינטרנטי בעברית להצגת החבילות הישראליות מתוך `actorquiz/manifest.json`,
השוואת תמונות המקור מול Gemini, והכנת תוספות חדשות. גרסת GitHub Pages
שומרת את הטיוטות ב־localStorage של הדפדפן ומאפשרת לייצא אותן כ־JSON.

הפעלה:

```bash
python3 server.py
```

לאחר מכן פותחים בדפדפן: `http://localhost:8765`

לרענון הנתונים הסטטיים מה־manifest המקומי:

```bash
python3 generate_static_data.py
```
