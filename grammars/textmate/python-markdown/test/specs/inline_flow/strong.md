## marker

### accept_asterisk

``` md
**Strong**
```

### accept_underscore

``` md
__Strong__
```

### reject_escaped_asterisk

``` md
\**Strong**
```

### reject_escaped_underscore

``` md
\__Strong__
```

### reject_leading_space

``` md
** Strong**
```

### reject_trailing_space

``` md
**Strong **
```

## text

### accept_asterisk_with_escaped_marker

``` md
**Text\**Text**
```

### accept_underscore_with_escaped_marker

``` md
__Text\__Text__
```

### accept_line_ending_lf

``` md
**Text
Text**
```

## position

### accept_before_text

``` md
**Strong** Text
```

### accept_after_text

``` md
Text **Strong**
```

### accept_multiple

``` md
**One** **Two**
```

### accept_asterisk_inside_word

``` md
Text**Strong**Text
```

### reject_underscore_inside_word

``` md
Text__Strong__Text
```

## child

### accept_inline_code

``` md
**`[code]`**
```

### accept_link

``` md
**[Text](href)**
```

### accept_link_reference

``` md
**[Text][id]**
```

### accept_autolink

``` md
**<https://example.com>**
```
