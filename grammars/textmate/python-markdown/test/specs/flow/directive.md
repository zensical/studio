## conditions

### if_elif_else

``` md
@if product = studio OR not platform = "windows"
    Studio
@elif product = spark
    Spark
@else
    Other
```

## use

### quoted_and_bare_targets

``` md
@use "shared/guide.md"
@use shared/other.md
```
