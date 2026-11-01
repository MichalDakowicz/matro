// Language codes are stored as 2-letter ISO 639-1 where one exists. ffprobe reports 3-letter codes.
const table = 'en eng,ja jpn,pl pol,de ger deu,fr fre fra,es spa,it ita,pt por,ru rus,uk ukr,cs cze ces,sk slo slk,hu hun,ro rum ron,nl dut nld,sv swe,no nor nob nno,da dan,fi fin,el gre ell,tr tur,he heb,ar ara,zh chi zho,ko kor,hi hin,th tha,vi vie,id ind,bg bul,hr hrv,sr srp,sl slv,lt lit,lv lav,et est,ca cat,fa per fas,ms may msa,bn ben,ta tam,te tel,la lat,is ice isl,ga gle,eu baq eus,gl glg'.split(',');
const to2 = new Map(table.flatMap(row => { const [two, ...threes] = row.split(' '); return [[two, two], ...threes.map(three => [three, two])]; }));

function normalize(code) {
  const base = String(code || '').trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(base) || base === 'und' || base === 'unk' || base === 'mis' || base === 'zxx') return 'und';
  return to2.get(base) || base;
}
// Subtitle files are rarely UTF-8 when they come from older releases; pick the legacy code page that language used.
const legacy = { pl: 'windows-1250', cs: 'windows-1250', sk: 'windows-1250', hu: 'windows-1250', ro: 'windows-1250', hr: 'windows-1250', sl: 'windows-1250', sr: 'windows-1250',
  ru: 'windows-1251', uk: 'windows-1251', bg: 'windows-1251', el: 'windows-1253', tr: 'windows-1254', he: 'windows-1255', ar: 'windows-1256',
  lt: 'windows-1257', lv: 'windows-1257', et: 'windows-1257', ja: 'shift_jis', ko: 'euc-kr', zh: 'gbk' };
const charsetFor = language => legacy[language] || 'windows-1252';
module.exports = { normalize, charsetFor };
