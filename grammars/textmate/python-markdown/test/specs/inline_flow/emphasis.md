## marker

### accept_asterisk

``` md
*Emphasis*
```

### accept_underscore

``` md
_Emphasis_
```

### accept_strong_asterisk

``` md
**Strong**
```

### accept_strong_underscore

``` md
__Strong__
```

### reject_escaped_asterisk

``` md
\*Emphasis*
```

### reject_escaped_underscore

``` md
\_Emphasis_
```

### reject_escaped_strong_asterisk

``` md
\**Strong**
```

### reject_escaped_strong_underscore

``` md
\__Strong__
```

### reject_leading_space

``` md
* Emphasis*
```

### reject_trailing_space

``` md
*Emphasis *
```

### reject_strong_leading_space

``` md
** Strong**
```

### reject_strong_trailing_space

``` md
**Strong **
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

### accept_strong_asterisk_with_escaped_marker

``` md
**Text\**Text**
```

### accept_strong_underscore_with_escaped_marker

``` md
__Text\__Text__
```

### accept_line_ending_lf

``` md
*Text
Text*
```

### accept_strong_line_ending_lf

``` md
**Text
Text**
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

### accept_strong_before_text

``` md
**Strong** Text
```

### accept_strong_after_text

``` md
Text **Strong**
```

### accept_strong_multiple

``` md
**One** **Two**
```

### accept_asterisk_inside_word

``` md
Text*Emphasis*Text
```

### reject_underscore_inside_word

``` md
Text_Emphasis_Text
```

### accept_strong_asterisk_inside_word

``` md
Text**Strong**Text
```

### reject_strong_underscore_inside_word

``` md
Text__Strong__Text
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

### accept_strong_inline_code

``` md
**`[code]`**
```

### accept_strong_link

``` md
**[Text](href)**
```

### accept_strong_link_reference

``` md
**[Text][id]**
```

### accept_strong_autolink

``` md
**<https://example.com>**
```

## nesting

### accept_nested_emphasis_asterisk

``` md
***Strong emphasis***
```

### accept_nested_emphasis_underscore

``` md
___Strong emphasis___
```

### accept_mixed_strong

``` md
*Emphasis __strong__*
```

### accept_mixed_emphasis

``` md
**Strong _emphasis_**
```

### accept_strong_tail_asterisk

``` md
***Emphasis strong** rest*
```

### accept_strong_tail_underscore

``` md
___Emphasis strong__ rest_
```

### accept_emphasis_tail_asterisk

``` md
***Strong emphasis* rest**
```

### accept_emphasis_tail_underscore

``` md
___Strong emphasis_ rest__
```

### accept_trailing_emphasis_asterisk

``` md
**Strong *emphasis***
```

### accept_trailing_emphasis_underscore

``` md
__Strong _emphasis___
```

## boundary

### accept_underscore_strong_boundary

``` md
a___x__ y_
```

### accept_underscore_emphasis_boundary

``` md
___x_ y__b
```

### accept_underscore_boundary_before

``` md
a___x___
```

### accept_underscore_boundary_after

``` md
___x___b
```

## partial

### accept_partial_asterisk

``` md
*Emphasis **strong***
```

### accept_partial_strong

``` md
_Emphasis **strong***
```

### accept_partial_emphasis

``` md
__Strong *emphasis***
```

### reject_mixed_triple_open

``` md
___Strong emphasis***
```

### reject_mixed_triple_close

``` md
***Strong emphasis___
```
