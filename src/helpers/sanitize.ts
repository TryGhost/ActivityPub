import doSanitizeHtml from 'sanitize-html';

export function sanitizeHtml(content: string): string {
    if (!content) {
        return content;
    }

    return doSanitizeHtml(content, {
        allowedTags: ['address', 'img', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote', 'dd', 'div',
  'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'main', 'ol', 'p', 'pre',
  'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
  'em', 'i', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption',
  'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'svg', 'defs', 'style', 'rect', 'polyline', 'line', 'circle', 'button', 'input', 'path', 'audio', 'video'],
        allowedClasses: {
            '*': false
          },
          allowedAttributes: false
    });
}
