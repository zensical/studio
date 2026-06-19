## marker

### accept_asterisk

``` md
*Emphasis*
```

### accept_underscore

``` md
_Emphasis_
```

### reject_escaped_asterisk

``` md
\*Emphasis*
```

### reject_escaped_underscore

``` md
\_Emphasis_
```

### reject_leading_space

``` md
* Emphasis*
```

### reject_trailing_space

``` md
*Emphasis *
```

## text

### accept_asterisk_with_escaped_marker

``` md
*Text\*Text*
```

### accept_underscore_with_escaped_marker

``` md
_Text\_Text_
```

### accept_line_ending_lf

``` md
*Text
Text*
```

## position

### accept_before_text

``` md
*Emphasis* Text
```

### accept_after_text

``` md
Text *Emphasis*
```

### accept_multiple

``` md
*One* *Two*
```

### accept_asterisk_inside_word

``` md
Text*Emphasis*Text
```

### reject_underscore_inside_word

``` md
Text_Emphasis_Text
```

## child

### accept_inline_code

``` md
*`[code]`*
```

### accept_link

``` md
*[Text](href)*
```

### accept_link_reference

``` md
*[Text][id]*
```

### accept_autolink

``` md
*<https://example.com>*
```
