import React, {useEffect, useId, useRef, useState} from 'react';
import {AnimateIcon} from './animate-ui/icons/icon';
import {Check} from './animate-ui/icons/check';
import {ChevronDown} from './animate-ui/icons/chevron-down';
import './Select.css';

// Keep in step with .select-list max-height: decides when to open upward.
const LIST_MAX_HEIGHT = 280;
const CAN_HOVER = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(hover: hover)').matches);

/**
 * A dropdown drawn by the page instead of the OS, so it matches everything
 * around it in both themes and cannot be clipped the way a native select's
 * arrow was.
 *
 * It is the ARIA "select-only combobox": focus never leaves the trigger, the
 * open list is followed through aria-activedescendant, and the keyboard does
 * what a native select's does — arrows, Home/End, Enter/Space, Esc, and typing
 * a letter to jump.
 */
export function Select({value, options, onChange, label, className = ''}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [placement, setPlacement] = useState({above: false, right: false});
    const rootRef = useRef(null);
    const listRef = useRef(null);
    const listId = useId();
    const selected = Math.max(0, options.findIndex((o) => o.id === value));

    const openList = (highlight = selected) => {
        // Upward only when it would run off the bottom and there is more room
        // above; leftward when the trigger sits in the right half.
        const rect = rootRef.current.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom;
        setPlacement({
            above: below < LIST_MAX_HEIGHT && rect.top > below,
            right: rect.left + rect.width / 2 > window.innerWidth / 2,
        });
        setActive(highlight);
        setOpen(true);
    };

    const choose = (index) => {
        onChange(options[index].id);
        setOpen(false);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (e) => {
            if (!rootRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [open]);

    useEffect(() => {
        if (open) listRef.current?.children[active]?.scrollIntoView({block: 'nearest'});
    }, [open, active]);

    // The next option after the highlighted one whose label starts with `key`,
    // wrapping around, so pressing a letter repeatedly walks through its group.
    const findByLetter = (key, from) => {
        const letter = key.toLowerCase();
        for (let step = 1; step <= options.length; step += 1) {
            const index = (from + step) % options.length;
            if (options[index].label.toLowerCase().startsWith(letter)) return index;
        }
        return -1;
    };

    const handleKeyDown = (e) => {
        const last = options.length - 1;
        const typed = e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey;

        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
                e.preventDefault();
                openList();
            } else if (typed) {
                const match = findByLetter(e.key, selected);
                if (match !== -1) openList(match);
            }
            return;
        }

        if (e.key === 'ArrowDown') setActive((i) => Math.min(last, i + 1));
        else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
        else if (e.key === 'Home') setActive(0);
        else if (e.key === 'End') setActive(last);
        else if (e.key === 'Enter' || e.key === ' ') choose(active);
        else if (e.key === 'Escape') setOpen(false);
        else if (e.key === 'Tab') {
            setOpen(false);
            return;
        } else if (typed) {
            const match = findByLetter(e.key, active);
            if (match !== -1) setActive(match);
            return;
        } else {
            return;
        }
        e.preventDefault();
    };

    return (
        <div className={`select ${className}`} ref={rootRef}>
            <AnimateIcon asChild animateOnHover={CAN_HOVER}>
                <button
                    type="button"
                    role="combobox"
                    className="select-trigger"
                    aria-label={label}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-activedescendant={open ? `${listId}-${active}` : undefined}
                    onClick={() => (open ? setOpen(false) : openList())}
                    onKeyDown={handleKeyDown}
                >
                    <span className="select-value">{options[selected]?.label}</span>
                    <ChevronDown size={16} className="select-chevron" aria-hidden="true" />
                </button>
            </AnimateIcon>
            {open && (
                <ul
                    id={listId}
                    ref={listRef}
                    role="listbox"
                    aria-label={label}
                    className={`select-list ${placement.above ? 'is-above' : ''} ${placement.right ? 'is-right' : ''}`}
                >
                    {options.map((option, index) => (
                        <li
                            key={option.id}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={index === selected}
                            className={`select-option ${index === active ? 'is-active' : ''}`}
                            // Focus stays on the trigger, or the keyboard would
                            // lose the list it is driving.
                            onMouseDown={(e) => e.preventDefault()}
                            onPointerMove={() => setActive(index)}
                            onClick={() => choose(index)}
                        >
                            <span>{option.label}</span>
                            {index === selected && <Check size={14} aria-hidden="true" />}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
