import doSanitizeHtml from 'sanitize-html';

export function sanitizeHtml(content: string): string {
    if (!content) {
        return content;
    }

    return doSanitizeHtml(content, {
        allowedTags: [
            'address', 'img', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4',
            'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote', 'dd', 'div',
            'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'main', 'ol', 'p', 'pre',
            'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
            'em', 'i', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp',
            'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption',
            'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'svg',
            'defs', 'iframe', 'rect', 'polyline', 'line', 'circle', 'button', 'input',
            'path', 'audio', 'video',
        ],
        allowedClasses: {
            '*': false
        },
        allowedAttributes: {
            // Global attributes
            '*': ['id', 'class', 'title', 'lang', 'dir', 'tabindex', 'style'],

            // Specific HTML elements
            a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
            img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
            audio: ['src', 'autoplay', 'controls', 'loop', 'muted', 'preload'],
            video: ['src', 'autoplay', 'controls', 'loop', 'muted', 'preload', 'poster', 'width', 'height'],
            button: ['type', 'disabled', 'form', 'formaction', 'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'name', 'value'],
            input: ['type', 'accept', 'alt', 'autocomplete', 'autofocus', 'checked', 'disabled', 'form', 'formaction', 'formenctype', 'formmethod', 'formnovalidate', 'formtarget', 'list', 'max', 'maxlength', 'min', 'minlength', 'multiple', 'name', 'pattern', 'placeholder', 'readonly', 'required', 'size', 'src', 'step', 'value'],
            table: ['border', 'cellpadding', 'cellspacing'],
            td: ['colspan', 'rowspan', 'headers'],
            th: ['colspan', 'rowspan', 'headers', 'scope'],

            // SVG elements
            svg: ['viewBox', 'width', 'height', 'viewbox', 'preserveAspectRatio', 'xmlns'],
            circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
            rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
            line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
            polyline: ['points', 'fill', 'stroke', 'stroke-width'],
            path: ['d', 'fill', 'stroke', 'stroke-width'],
            text: ['x', 'y', 'font-family', 'font-size', 'fill'],
            g: ['transform'],
            defs: [],
            style: ['type']
        },
    });
}
