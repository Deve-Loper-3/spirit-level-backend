const { escapeHtml } = require('../../src/utils/html.util');

describe('html.util', () => {
  describe('escapeHtml', () => {
    it('escapes &, <, >, " and \'', () => {
      expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
        '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;',
      );
    });

    it('escapes & first so entities are not double-escaped by mistake', () => {
      expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    });

    it('leaves plain text unchanged', () => {
      expect(escapeHtml('Jane Doe')).toBe('Jane Doe');
    });

    it('converts non-string values to a string', () => {
      expect(escapeHtml(42)).toBe('42');
    });
  });
});
