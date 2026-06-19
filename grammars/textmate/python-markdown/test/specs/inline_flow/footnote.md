## id

### accept_plain

``` md
[^1]
```

### accept_named

``` md
[^note]
```

### accept_special

``` md
[^@#$%]
```

### accept_unicode

``` md
[^é]
```

### accept_single_space

``` md
[^ ]
```

### accept_tab

``` md
[^	]
```

### accept_leading_space

``` md
[^ note]
```

### accept_trailing_space

``` md
[^note ]
```

### accept_empty

``` md
[^]
```

### accept_multi_word

``` md
[^multi word note]
```

### accept_backslash

``` md
[^te\xt]
```

### accept_opening_bracket

``` md
[^note[text]
```

### accept_double_caret

``` md
[^^]
```

### accept_line_ending_lf

``` md
[^note
]
```

### accept_multiple_line_endings

``` md
[^text
and
more]
```

## position

### accept_before_text

``` md
[^note] Text
```

### accept_after_text

``` md
Text [^note]
```

### accept_multiple

``` md
[^1] [^2]
```

### accept_until_first_closing_bracket

``` md
[^note\]text]
```

## attribute_list

### accept_plain

``` md
[^note]{#id}
```

### accept_spaced

``` md
[^note]{ #id .class key="value" }
```

## rejection

### reject_link_reference_without_caret

``` md
[1]
```

### reject_unterminated

``` md
[^1
```

### reject_escaped

``` md
\[^1]
```
