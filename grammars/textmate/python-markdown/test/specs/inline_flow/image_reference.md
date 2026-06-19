## complete

### accept_plain

``` md
![Text][id]
```

### accept_collapsed

``` md
![Text][]
```

### accept_shortcut

``` md
![Text]
```

## text

### accept_empty

``` md
![][id]
```

### accept_leading_space

``` md
![ Text][id]
```

### accept_trailing_space

``` md
![Text ][id]
```

### accept_surrounding_space

``` md
![ Text ][id]
```

### accept_escaped_closing_bracket

``` md
![Text \]][id]
```

### accept_nested_brackets

``` md
![alt [Nested]][id]
```

## id

### accept_multi_word

``` md
![Text][multi word]
```

### accept_escaped_closing_bracket

``` md
![Text][id \]]
```

### accept_partial

``` md
![Text][id
```

### reject_leading_space

``` md
![Text][ id]
```

### reject_trailing_space

``` md
![Text][id ]
```

## gap

### accept_1_space_before

``` md
![Text] [id]
```

### accept_1_tab_before

``` md
![Text]	[id]
```

### reject_2_spaces_before

``` md
![Text]  [id]
```

## attribute_list

### accept_explicit

``` md
![Text][id]{#id}
```

### accept_collapsed

``` md
![Text][]{#id}
```

### accept_shortcut

``` md
![Text]{#id}
```

## marker

### reject_escaped_opening_bracket

``` md
\![Text][id]
```

### reject_escaped_closing_bracket

``` md
![Text\][id]
```

## rejection

### reject_unbalanced_nested_brackets

``` md
![alt [Nested
```

### reject_empty_shortcut

``` md
![]
```

### reject_empty_collapsed

``` md
![][]
```

### reject_text_unterminated

``` md
![Text
```
