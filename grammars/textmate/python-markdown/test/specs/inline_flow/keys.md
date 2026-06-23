## name

### accept_named_key

``` md
++enter++
```

### accept_key_alias

``` md
++pg-up++
```

### accept_function_key

``` md
++f12++
```

### accept_unicode_key

``` md
++é++
```

## sequence

### accept_key_sequence

``` md
++ctrl+alt+delete++
```

### accept_key_name_with_side

``` md
++left-control++
```

### accept_key_name_with_side_in_sequence

``` md
++ctrl+left-control++
```

## quoted

### accept_quoted_key

``` md
++"enter delete"++
```

### accept_single_quoted_key

``` md
++'enter delete'++
```

### accept_escaped_quoted_key

``` md
++"control\"alt"++
```

### accept_escaped_plus_in_quoted_key

``` md
++"control\+alt"++
```

### accept_mixed_named_and_quoted_keys

``` md
++ctrl+"alt delete"++
```

## position

### accept_before_text

``` md
++enter++ Text
```

### accept_after_text

``` md
Text ++enter++
```

### accept_multiple

``` md
++ctrl++ ++alt++
```

## nesting

### accept_inside_emphasis

``` md
*++enter++*
```

### accept_inside_link

``` md
[++enter++](href)
```

## rejection

### reject_blank_key

``` md
++++
```

### reject_unterminated_key

``` md
++enter
```

### reject_escaped_key

``` md
\++enter++
```

### reject_unescaped_plus_in_quoted_key

``` md
++"control+alt"++
```

### reject_empty_quoted_key

``` md
+""++
```
