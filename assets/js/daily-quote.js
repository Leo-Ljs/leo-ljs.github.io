/* 每日一言
   ------------------------------------------------------------
   规则：
   1. 同一天内固定一句（localStorage 按日期缓存）。
   2. 换一天就换一句：本地词库按日期做确定性轮换，
      并避开前一天出现过的那一句。
   3. 有网络时额外向「一言」接口取一句，成功后替换并缓存；
      取不到就安静地留在本地词库，不打断阅读。 */

(function () {
  "use strict";

  var STORE_KEY = "leo.daily-quote.v1";
  var API = "https://v1.hitokoto.cn/?c=d&c=i&c=k&charset=utf-8&encode=json";

  /* 本地句子库：[句子, 出处] */
  var POOL = [
    ["学而时习之，不亦说乎？", "《论语 · 学而》"],
    ["知之为知之，不知为不知，是知也。", "《论语 · 为政》"],
    ["学而不思则罔，思而不学则殆。", "《论语 · 为政》"],
    ["温故而知新，可以为师矣。", "《论语 · 为政》"],
    ["敏而好学，不耻下问。", "《论语 · 公冶长》"],
    ["见贤思齐焉，见不贤而内自省也。", "《论语 · 里仁》"],
    ["三人行，必有我师焉。", "《论语 · 述而》"],
    ["君子和而不同，小人同而不和。", "《论语 · 子路》"],
    ["欲速则不达。", "《论语 · 子路》"],
    ["工欲善其事，必先利其器。", "《论语 · 卫灵公》"],
    ["己所不欲，勿施于人。", "《论语 · 卫灵公》"],
    ["士不可以不弘毅，任重而道远。", "《论语 · 泰伯》"],
    ["岁寒，然后知松柏之后凋也。", "《论语 · 子罕》"],
    ["逝者如斯夫，不舍昼夜。", "《论语 · 子罕》"],
    ["不患人之不己知，患不知人也。", "《论语 · 学而》"],
    ["吾日三省吾身。", "《论语 · 学而》"],
    ["上善若水，水善利万物而不争。", "《道德经》"],
    ["千里之行，始于足下。", "《道德经》"],
    ["知人者智，自知者明。", "《道德经》"],
    ["大直若屈，大巧若拙，大辩若讷。", "《道德经》"],
    ["天行健，君子以自强不息。", "《周易 · 乾》"],
    ["地势坤，君子以厚德载物。", "《周易 · 坤》"],
    ["穷则变，变则通，通则久。", "《周易 · 系辞》"],
    ["博学之，审问之，慎思之，明辨之，笃行之。", "《礼记 · 中庸》"],
    ["凡事豫则立，不豫则废。", "《礼记 · 中庸》"],
    ["玉不琢，不成器；人不学，不知道。", "《礼记 · 学记》"],
    ["不积跬步，无以至千里；不积小流，无以成江海。", "荀子《劝学》"],
    ["锲而不舍，金石可镂。", "荀子《劝学》"],
    ["青，取之于蓝，而青于蓝。", "荀子《劝学》"],
    ["路漫漫其修远兮，吾将上下而求索。", "屈原《离骚》"],
    ["亦余心之所善兮，虽九死其犹未悔。", "屈原《离骚》"],
    ["静以修身，俭以养德。", "诸葛亮《诫子书》"],
    ["非淡泊无以明志，非宁静无以致远。", "诸葛亮《诫子书》"],
    ["老骥伏枥，志在千里。", "曹操《龟虽寿》"],
    ["采菊东篱下，悠然见南山。", "陶渊明《饮酒》"],
    ["盛年不重来，一日难再晨。", "陶渊明《杂诗》"],
    ["海内存知己，天涯若比邻。", "王勃《送杜少府之任蜀州》"],
    ["落霞与孤鹜齐飞，秋水共长天一色。", "王勃《滕王阁序》"],
    ["会当凌绝顶，一览众山小。", "杜甫《望岳》"],
    ["随风潜入夜，润物细无声。", "杜甫《春夜喜雨》"],
    ["读书破万卷，下笔如有神。", "杜甫《奉赠韦左丞丈二十二韵》"],
    ["长风破浪会有时，直挂云帆济沧海。", "李白《行路难》"],
    ["天生我材必有用，千金散尽还复来。", "李白《将进酒》"],
    ["山重水复疑无路，柳暗花明又一村。", "陆游《游山西村》"],
    ["纸上得来终觉浅，绝知此事要躬行。", "陆游《冬夜读书示子聿》"],
    ["问渠那得清如许？为有源头活水来。", "朱熹《观书有感》"],
    ["等闲识得东风面，万紫千红总是春。", "朱熹《春日》"],
    ["不识庐山真面目，只缘身在此山中。", "苏轼《题西林壁》"],
    ["竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", "苏轼《定风波》"],
    ["回首向来萧瑟处，归去，也无风雨也无晴。", "苏轼《定风波》"],
    ["但愿人长久，千里共婵娟。", "苏轼《水调歌头》"],
    ["博观而约取，厚积而薄发。", "苏轼《稼说送张琥》"],
    ["业精于勤，荒于嬉；行成于思，毁于随。", "韩愈《进学解》"],
    ["沉舟侧畔千帆过，病树前头万木春。", "刘禹锡《酬乐天扬州初逢席上见赠》"],
    ["千淘万漉虽辛苦，吹尽狂沙始到金。", "刘禹锡《浪淘沙》"],
    ["临渊羡鱼，不如退而结网。", "《汉书 · 董仲舒传》"],
    ["桃李不言，下自成蹊。", "《史记 · 李将军列传》"],
    ["燕雀安知鸿鹄之志哉。", "《史记 · 陈涉世家》"],
    ["人固有一死，或重于泰山，或轻于鸿毛。", "司马迁《报任安书》"],
    ["宝剑锋从磨砺出，梅花香自苦寒来。", "古训"],
    ["读万卷书，行万里路。", "古训"],
    ["你站在桥上看风景，看风景的人在楼上看你。", "卞之琳《断章》"],
    ["黑夜给了我黑色的眼睛，我却用它寻找光明。", "顾城《一代人》"],
    ["面朝大海，春暖花开。", "海子"],
    ["世界以痛吻我，要我报之以歌。", "泰戈尔《飞鸟集》"],
    ["生如夏花之绚烂，死如秋叶之静美。", "泰戈尔《飞鸟集》"],
    ["天空没有留下鸟的痕迹，但我已飞过。", "泰戈尔《飞鸟集》"],
    ["Simplicity is prerequisite for reliability.", "Edsger W. Dijkstra"],
    ["Premature optimization is the root of all evil.", "Donald Knuth"],
    ["The best way to predict the future is to invent it.", "Alan Kay"],
    ["What I cannot create, I do not understand.", "Richard Feynman"],
    ["Talk is cheap. Show me the code.", "Linus Torvalds"],
    ["Any sufficiently advanced technology is indistinguishable from magic.", "Arthur C. Clarke"],
    ["Less is more.", "Ludwig Mies van der Rohe"],
    ["Make it work, make it right, make it fast.", "Kent Beck"],
    ["Fools ignore complexity. Pragmatists suffer it. Some can avoid it. Geniuses remove it.", "Alan Perlis"],
    ["Our life is frittered away by detail. Simplify, simplify.", "Henry David Thoreau"],
    ["The details are not the details. They make the design.", "Charles Eames"],
    ["Design is not just what it looks like and feels like. Design is how it works.", "Steve Jobs"]
  ];

  var elQuote = document.getElementById("daily-quote");
  var elFrom = document.getElementById("daily-quote-from");
  var elDate = document.getElementById("daily-date");
  var elStatus = document.getElementById("daily-status");
  var elInline = document.querySelector("[data-quote-inline-text]");

  if (!elQuote) return;

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function dateLabel(d) {
    var week = ["日", "一", "二", "三", "四", "五", "六"];
    return (
      d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 · 星期" + week[d.getDay()]
    );
  }

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function readCache() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : null;
    } catch (error) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (error) {
      /* 隐私模式下写不了，忽略即可 */
    }
  }

  function render(text, from, status) {
    elQuote.textContent = text;
    if (elFrom) elFrom.textContent = "— " + from;
    if (elStatus && status) elStatus.textContent = status;
    if (elInline) {
      elInline.textContent = "“" + text + "” " + from;
    }
  }

  function swap(text, from, status) {
    if (reduce()) {
      render(text, from, status);
      return;
    }
    elQuote.classList.add("is-swapping");
    window.setTimeout(function () {
      render(text, from, status);
      elQuote.classList.remove("is-swapping");
    }, 220);
  }

  function reduce() {
    return (
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  var today = new Date();
  var key = dateKey(today);
  var cache = readCache();

  if (elDate) elDate.textContent = dateLabel(today);

  if (cache && cache.date === key && cache.text) {
    render(cache.text, cache.from || "Leo 的小站", cache.source === "hitokoto" ? "今日 · 一言" : "今日 · 本地词库");
  } else {
    var index = hash(key) % POOL.length;
    if (cache && cache.text && POOL[index][0] === cache.text) {
      index = (index + 1) % POOL.length;
    }
    var picked = POOL[index];
    var previous = cache && cache.text ? cache.text : "";
    render(picked[0], picked[1], "本地词库");
    cache = {
      date: key,
      text: picked[0],
      from: picked[1],
      source: "local",
      previous: previous
    };
    writeCache(cache);
  }

  /* 尝试从「一言」取一句；失败就保持现状 */
  if (typeof window.fetch === "function" && /^https?:$/.test(window.location.protocol)) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 4000);

    window
      .fetch(API, {
        signal: controller ? controller.signal : undefined,
        cache: "no-store",
        credentials: "omit"
      })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        window.clearTimeout(timer);
        if (!data || typeof data.hitokoto !== "string") return;
        var text = data.hitokoto.trim();
        if (!text) return;
        var from = data.from ? (data.from_who ? data.from_who + " · " : "") + data.from : "一言";
        var current = readCache() || cache;
        if (current && current.date === key && current.text === text) {
          if (elStatus) elStatus.textContent = "今日 · 一言";
          return;
        }
        var previousText = current && current.previous ? current.previous : current && current.text ? current.text : "";
        writeCache({ date: key, text: text, from: from, source: "hitokoto", previous: previousText });
        swap(text, from, "今日 · 一言");
      })
      .catch(function () {
        window.clearTimeout(timer);
      });
  }
})();
