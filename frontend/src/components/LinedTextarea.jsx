import React, {useRef} from 'react';
import './LinedTextarea.css';

const INDENT = '  ';

/**
 * A textarea whose line numbers stay on the line they number.
 *
 * Every line is mirrored, invisibly, into its own grid row beside its number,
 * in the textarea's own font and width. A line that soft-wraps makes its row
 * taller, so the next number moves down with it. The real textarea is laid
 * over the mirror column and grows with it rather than scrolling on its own —
 * a textarea that scrolls by itself slides out from under its gutter.
 *
 * ponytail: one row per line is rendered on every keystroke. Fine for clipboard
 * snippets; a virtualised gutter is the upgrade if huge pastes ever feel slow.
 */
export function LinedTextarea({value, onChange, code = false, onKeyDown, inputRef, ...rest}) {
    const ownRef = useRef(null);
    const textareaRef = inputRef ?? ownRef;
    const lines = value.split('\n');

    // The gutter and the frame's margin are part of the editor too. A press
    // anywhere outside the textarea used to leave focus wherever it was, so
    // whatever was typed next went nowhere. A line number puts the caret at
    // the start of its line, the way an editor's gutter does.
    const handleMouseDown = (e) => {
        const textarea = textareaRef.current;
        if (!textarea || e.target === textarea) return;
        e.preventDefault();
        textarea.focus();
        const line = e.target.dataset?.line;
        if (line !== undefined) {
            const offset = lines.slice(0, Number(line)).reduce((n, text) => n + text.length + 1, 0);
            textarea.setSelectionRange(offset, offset);
        }
    };

    const handleKeyDown = (e) => {
        // insertText rather than rebuilding the value: it keeps the edit on the
        // browser's undo stack. Shift+Tab is left alone so focus can still leave.
        if (code && e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertText', false, INDENT);
            return;
        }
        onKeyDown?.(e);
    };

    return (
        <div className={`lined ${code ? 'is-code' : ''}`}>
            <div className="lined-grid" onMouseDown={handleMouseDown}>
                {lines.map((line, i) => (
                    <React.Fragment key={i}>
                        <span className="lined-num" data-line={i} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                        {/* A zero-width space gives an empty line its height. */}
                        <span className="lined-ghost" aria-hidden="true">{line || '\u200b'}</span>
                    </React.Fragment>
                ))}
                <textarea
                    ref={textareaRef}
                    className="lined-input"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    spellCheck="false"
                    {...rest}
                />
            </div>
        </div>
    );
}
