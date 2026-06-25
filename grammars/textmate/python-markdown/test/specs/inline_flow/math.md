## dollar_valid

### accept_plain

``` md
$a$
```

### accept_commands

``` md
$\alpha + \beta$
```

### accept_parenthesized

``` md
$(a)$
```

### accept_escaped_dollar

``` md
$a \$ b$
```

### accept_trailing_marker

``` md
$a$$
```

### accept_leading_marker

``` md
$$a$
```

### accept_before_text

``` md
$a$ Text
```

### accept_after_text

``` md
Text $a$
```

### accept_inside_word

``` md
x$a$y
```

### accept_before_punctuation

``` md
$a$,
```

### accept_inside_emphasis

``` md
*$a$*
```

### accept_inside_link

``` md
[$a$](href)
```

## round_valid

### accept_plain

``` md
\(a\)
```

### accept_commands

``` md
\(\begin{matrix} a & b \\ c & d \end{matrix}\)
```

### accept_escaped_closer

``` md
\(a \\) b\)
```

## dollar_invalid

### reject_opening_space

``` md
$ Math$
```

### reject_opening_tab

``` md
$	Math$
```

### reject_closing_space

``` md
$Math $
```

### reject_closing_tab

``` md
$Math	$
```

### reject_unterminated

``` md
$a
```

### reject_escaped_opening

``` md
\$a$
```

### reject_closing_marker_as_text

``` md
$a $ b$
```

## round_invalid

### reject_unterminated

``` md
\(a
```

### reject_blank_line

``` md
\(a

b\)
```

### reject_inline_square_form

``` md
\[Math\]
```
