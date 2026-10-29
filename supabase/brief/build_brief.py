# Regenerates the assignment text inside supabase/sql/08_hiring.sql from supabase/brief/assignment.md
import markdown, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
html = markdown.markdown((root/'brief/assignment.md').read_text(), extensions=['tables'])
assert '$brief$' not in html
block = f"-- BRIEF-START\ninsert into app.hiring_brief (id, html) values (1, $brief${html}$brief$)\non conflict (id) do update set html = excluded.html;\n-- BRIEF-END"
p = root/'sql/08_hiring.sql'
s = p.read_text()
s = re.sub(r'-- BRIEF-START.*?-- BRIEF-END', lambda m: block, s, flags=re.S)
p.write_text(s)
print('brief written', len(html), 'chars')
