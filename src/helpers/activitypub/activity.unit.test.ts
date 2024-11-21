import { describe, expect, it } from 'vitest';
import { prepareNoteContent } from './activity';

describe('prepareNoteContent', () => {
    it('should wrap the content in a <p> tag', () => {
        const content = 'Hello, world!';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello, world!</p>');
    });

    it('should ensure newlines are converted to <br /> tags', () => {
        const content = 'Hello\nWorld';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello<br />World</p>');
    });

    it('should trim each line', () => {
        const content = 'Hello      \nWorld  ';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello<br />World</p>');
    });

    it('should skip empty lines', () => {
        const content = 'Hello\n\nWorld\n';
        const result = prepareNoteContent(content);

        expect(result).toEqual('<p>Hello<br />World</p>');
    });
});
