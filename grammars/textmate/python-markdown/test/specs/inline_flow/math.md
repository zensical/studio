## marker

### accept_dollar

``` md
$Math$
```

### accept_dollar_with_parentheses

``` md
$(Math)$
```

### accept_dollar_with_escaped_dollar

``` md
$Math \$ Text$
```

### accept_dollar_with_closing_marker

``` md
$Math $ Text$
```

### accept_dollar_with_trailing_marker

``` md
$Math$$
```

### accept_dollar_with_leading_marker

``` md
$$Math$
```

### accept_round

``` md
\(Math\)
```

### accept_round_with_escaped_parentheses

``` md
\(Math \\) Text\)
```

## position

### accept_before_text

``` md
$Math$ Text
```

### accept_after_text

``` md
Text $Math$
```

### accept_inside_emphasis

``` md
*$Math$*
```

### accept_inside_link

``` md
[$Math$](href)
```

## line_ending

### accept_dollar_with_line_ending

``` md
$Math
Text$
```

### accept_round_with_line_ending

``` md
\(Math
Text\)
```

## rejection

### reject_dollar_with_opening_space

``` md
$ Math$
```

### reject_dollar_with_opening_tab

``` md
$	Math$
```

### reject_dollar_with_closing_space

``` md
$Math $
```

### reject_dollar_with_closing_tab

``` md
$Math	$
```

### reject_dollar_with_closing_line_ending

``` md
$Math
$
```

### reject_dollar_unterminated

``` md
$Math
```

### reject_dollar_with_escaped_opening

``` md
\$Math$
```

### reject_round_unterminated

``` md
\(Math
```

### reject_square_block_math

``` md
\[Math\]
```
