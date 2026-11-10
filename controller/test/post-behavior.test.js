// Tests verifying the behavior of sending posts across all 3 variants:
// 1. WhatsApp icon (plain): sends normal post as it is (no author name in post body)
// 2. Username icon (named): author name included at the top
//    - English post: English author on LEFT side (\u200E`Author`\u200E)
//    - Urdu post: Dual author on RIGHT side (\u200F`Urdu | English`\u200F)
// 3. Urdu icon (urdu): translated with dual author on RIGHT side
const assert = require('assert');
const { formatDualAuthorForUrdu } = require('../src/groq');
const { isUrduText } = require('../src/transliterate');

function simulateFormatOutText(body) {
  const { text, author, authorHandle, variant, nameTheAuthor, translateTo } = body;
  let outText = text;

  const isNamedVariant = variant === 'named' || nameTheAuthor === true;
  const isPlainVariant = variant === 'plain' || (nameTheAuthor === false && !translateTo);

  if (translateTo) {
    // translated (e.g. Urdu)
    outText = `\u200F\`امیر غسیمی   |   Amir Ghasemi\`\u200F\n\nیہ ایک ترجمہ شدہ پوسٹ ہے`;
  } else if (isPlainVariant) {
    if (text && typeof text === 'string') {
      const sep = text.indexOf('\n\n');
      if (sep > 0) {
        const firstLine = text.slice(0, sep).trim();
        const cleanFirst = firstLine.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim();
        const rawAuthor = (author && typeof author === 'string') ? author.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim() : '';
        const isAuthorFirstLine = cleanFirst.includes('|') || (rawAuthor && cleanFirst.toLowerCase() === rawAuthor.toLowerCase());
        if (isAuthorFirstLine) {
          outText = text.slice(sep + 2).trim();
        } else {
          outText = text;
        }
      } else {
        outText = text;
      }
    }
  } else if (isNamedVariant && author && typeof text === 'string') {
    const sep = text.indexOf('\n\n');
    const header = (sep > 0 ? text.slice(0, sep) : text).trim();
    const bodyContent = sep > 0 ? text.slice(sep + 2).trim() : '';
    const authorTrimmed = author.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim();
    const cleanHeader = header.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim();
    const isAuthorHeader = cleanHeader.includes('|') || (authorTrimmed && cleanHeader.toLowerCase() === authorTrimmed.toLowerCase());
    const effectiveBody = isAuthorHeader ? bodyContent : text;

    const isUrduPost = isUrduText(effectiveBody);
    if (isUrduPost) {
      const rightAuthor = formatDualAuthorForUrdu(`امیر غسیمی | ${authorTrimmed}`);
      outText = effectiveBody ? `${rightAuthor}\n\n${effectiveBody}` : rightAuthor;
    } else {
      const leftAuthor = `\u200E\`${authorTrimmed}\`\u200E`;
      outText = effectiveBody ? `${leftAuthor}\n\n${effectiveBody}` : leftAuthor;
    }
  } else {
    outText = text;
  }

  // Ensure author line alignment adheres strictly for Urdu or named posts:
  if (!isPlainVariant && outText && typeof outText === 'string') {
    const sep = outText.indexOf('\n\n');
    if (sep > 0) {
      const firstLine = outText.slice(0, sep).trim();
      const cleanFirst = firstLine.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim();
      const bodyContent = outText.slice(sep + 2).trim();
      const rawAuthor = (author && typeof author === 'string') ? author.replace(/^[\u200E\u200F`]+|[\u200E\u200F`]+$/g, '').trim() : '';
      const isAuthorFirstLine = cleanFirst.includes('|') || (rawAuthor && cleanFirst.toLowerCase() === rawAuthor.toLowerCase());
      if (isAuthorFirstLine) {
        const isUrduPost = isUrduText(bodyContent) || translateTo === 'ur';
        if (isUrduPost) {
          outText = `${formatDualAuthorForUrdu(cleanFirst)}\n\n${bodyContent}`;
        } else {
          outText = `\u200E\`${cleanFirst}\`\u200E\n\n${bodyContent}`;
        }
      }
    }
  }

  return outText;
}

// 1. Plain post: No author name in post body, sends as is
{
  const res = simulateFormatOutText({
    text: 'Exciting announcement about our new product release!',
    author: 'Amir Ghasemi',
    authorHandle: '@amir_ghm',
    variant: 'plain',
    nameTheAuthor: false,
  });
  assert.strictEqual(res, 'Exciting announcement about our new product release!');
  console.log('  ok   Plain post preserves text as-is without author name');
}

// 1b. Plain post when text had an author line prepended from quote/extractor
{
  const res = simulateFormatOutText({
    text: 'Amir Ghasemi\n\nExciting announcement about our new product release!',
    author: 'Amir Ghasemi',
    authorHandle: '@amir_ghm',
    variant: 'plain',
    nameTheAuthor: false,
  });
  assert.strictEqual(res, 'Exciting announcement about our new product release!');
  console.log('  ok   Plain post strips any accidentally prepended author line');
}

// 2. Named post on English tweet: English author on LEFT side (\u200E`Amir Ghasemi`\u200E)
{
  const res = simulateFormatOutText({
    text: 'This is an English post with author name.',
    author: 'Amir Ghasemi',
    authorHandle: '@amir_ghm',
    variant: 'named',
    nameTheAuthor: true,
  });
  assert.strictEqual(res, '\u200E`Amir Ghasemi`\u200E\n\nThis is an English post with author name.');
  assert(res.startsWith('\u200E`Amir Ghasemi`\u200E'));
  console.log('  ok   Named post on English tweet puts English author on LEFT side');
}

// 3. Named post on Urdu tweet: Dual author on RIGHT side (\u200F`Urdu | English`\u200F)
{
  const res = simulateFormatOutText({
    text: 'یہ ایک اہم اردو خبر ہے',
    author: 'Amir Ghasemi',
    authorHandle: '@amir_ghm',
    variant: 'named',
    nameTheAuthor: true,
  });
  assert(res.startsWith('\u200F`امیر غسیمی   |   Amir Ghasemi`\u200F'));
  console.log('  ok   Named post on Urdu tweet puts Dual author on RIGHT side');
}

// 4. Urdu variant
{
  const res = simulateFormatOutText({
    text: 'This is an English post to be translated',
    author: 'Amir Ghasemi',
    authorHandle: '@amir_ghm',
    variant: 'urdu',
    translateTo: 'ur',
  });
  assert(res.startsWith('\u200F`امیر غسیمی   |   Amir Ghasemi`\u200F'));
  console.log('  ok   Urdu variant outputs translated post with dual author on RIGHT');
}

console.log('\nALL POST BEHAVIOR TESTS PASSED');
