## marker

### accept_plain

``` md
==mark==
```

### reject_leading_space

``` md
== mark==
```

### reject_trailing_space

``` md
==mark ==
```

### reject_triple_equal

``` md
===mark===
```

## text

### accept_escaped_closing_marker

``` md
==mark\==text==
```

### accept_line_ending_lf

``` md
==ma
 rk==
```

### expect_line_ending_before_closing_as_mark

``` md
==ma
==
```

## position

### reject_inside_word

``` md
foo==mark==bar
```

## child

### accept_emphasis

``` md
==*mark*==
```

### accept_inline_code

``` md
==mark `[code]`==
```

## attribute_list

### accept_plain

``` md
==mark=={#id}
```
