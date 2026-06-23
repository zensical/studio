## parenthesized

### accept_trademark

``` md
(tm)
```

### accept_copyright

``` md
(c)
```

### accept_registered

``` md
(r)
```

## operator

### accept_plusminus

``` md
+/-
```

### accept_notequal

``` md
=/=
```

## arrow

### accept_left

``` md
<--
```

### accept_right

``` md
-->
```

### accept_both

``` md
<-->
```

## care_of

### accept_plain

``` md
c/o
```

## fraction

### accept_half

``` md
1/2
```

### accept_five_eighths

``` md
5/8
```

## ordinal

### accept_first

``` md
1st
```

### accept_eleventh

``` md
11th
```

### accept_twelfth

``` md
12th
```

### accept_thirty_second

``` md
32nd
```

### accept_hundred_third

``` md
103rd
```

## position

### accept_before_text

``` md
(c) Text
```

### accept_after_text

``` md
Text (c)
```

### accept_multiple

``` md
(c) +/- 1/2
```

## nesting

### accept_inside_emphasis

``` md
*(c)*
```

### accept_inside_link

``` md
[(c)](href)
```

## rejection

### reject_escaped_copyright

``` md
\(c)
```

### reject_uppercase_trademark

``` md
(TM)
```

### reject_uppercase_care_of

``` md
C/O
```

### reject_arrow_right_tail

``` md
---
```

### reject_arrow_left_tail

``` md
<---
```

### reject_wrong_ordinal_eleventh_second

``` md
11nd
```

### reject_wrong_ordinal_tenth

``` md
10st
```

### reject_wrong_ordinal_twenty_second

``` md
22th
```

### reject_leading_zero_ordinal

``` md
01st
```

### reject_fraction_digit_before

``` md
11/2
```

### reject_fraction_digit_after

``` md
1/22
```

### reject_care_of_before_underscore

``` md
c/o_
```
