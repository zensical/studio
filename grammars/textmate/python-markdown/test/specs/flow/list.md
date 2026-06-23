## marker

### accept_unordered_dash

``` md
- Item
```

### accept_unordered_asterisk

``` md
* Item
```

### accept_unordered_plus

``` md
+ Item
```

### accept_ordered

``` md
1. Item
```

### accept_with_3_leading_spaces

``` md
   - Item
```

## task

### accept_unchecked

``` md
- [ ] Task
```

### accept_checked_uppercase

``` md
* [X] Task
```

### accept_ordered

``` md
1. [ ] Task
```

### accept_tab_after_checkbox

``` md
- [ ]	Task
```

### accept_2_spaces_after_checkbox

``` md
- [ ]  Task
```

### accept_checkbox_without_text

``` md
- [ ] 
```

## rejection

### reject_marker_missing_space

``` md
-Item
```

### reject_checkbox_only

``` md
- [ ]
```

### reject_checkbox_invalid_marker

``` md
- [y] Task
```

### reject_checkbox_without_space_after

``` md
- [x]Task
```

### accept_with_4_leading_spaces

``` md
    - Item
```
