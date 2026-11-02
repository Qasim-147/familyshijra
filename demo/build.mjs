// Builds the single-file live demo from the same source files as the real site.
import { readFileSync, writeFileSync } from 'node:fs';
const r = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const index = r('index.html');
const img = readFileSync(new URL('../assets/img/haveli.jpg', import.meta.url)).toString('base64');
const body = index.split('<!--APP-START-->')[1].split('<!--APP-END-->')[0].replace('assets/img/haveli.jpg', 'data:image/jpeg;base64,' + img);
const out = `<title>Family Shijra Demo</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700;6..12,800&family=Reem+Kufi:wght@500;600;700&display=swap">
<style>
${r('assets/css/style.css')}
#siteFoot { display: none; }
</style>
${body}
<script>
${r('assets/js/family.js')}
</script>
<script>
${r('assets/js/bot.js')}
</script>
<script>
${r('demo/store-claude.js')}
</script>
<script>
${r('assets/js/app.js')}
</script>
`;
writeFileSync(new URL('./family-tree-demo.html', import.meta.url), out);
console.log('demo bytes', out.length);
