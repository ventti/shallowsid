#!/usr/bin/env bash

release_normalize_version() {
    local version=${1#v}
    if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        printf '%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    elif [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)-rc\.([0-9]+)$ ]]; then
        printf '%s.%s.%s-rc.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
    elif [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)rc([0-9]+)$ ]]; then
        printf '%s.%s.%s-rc.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"
    else
        return 1
    fi
}

release_pep440_version() {
    local version=$1
    if [[ "$version" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-rc\.([0-9]+)$ ]]; then
        printf '%src%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    else
        printf '%s\n' "$version"
    fi
}

release_bump_version() {
    local current=$1
    local bump=$2
    local major minor patch
    [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
    major=${BASH_REMATCH[1]}
    minor=${BASH_REMATCH[2]}
    patch=${BASH_REMATCH[3]}
    case "$bump" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
        *) return 1 ;;
    esac
    printf '%s.%s.%s\n' "$major" "$minor" "$patch"
}

release_version_gt() {
    local left=$1
    local right=$2
    local left_parts right_parts index
    [[ "$left" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    [[ "$right" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
    IFS=. read -r -a left_parts <<< "$left"
    IFS=. read -r -a right_parts <<< "$right"
    for index in 0 1 2; do
        if ((left_parts[index] > right_parts[index])); then
            return 0
        elif ((left_parts[index] < right_parts[index])); then
            return 1
        fi
    done
    return 1
}

release_recommended_bump() {
    local from_tag=${1:-}
    local range=HEAD
    local subjects bodies
    [[ -z "$from_tag" ]] || range="${from_tag}..HEAD"

    subjects=$(git log "$range" --pretty=format:%s)
    bodies=$(git log "$range" --pretty=format:%b)
    [[ -n "$subjects" ]] || return 1

    if printf '%s\n' "$subjects" | grep -Eiq '^[[:alnum:]-]+(\([^)]*\))?!: ' || \
       printf '%s\n' "$bodies" | grep -Eq '^BREAKING([ -])CHANGE: '; then
        printf '%s\n' major
    elif printf '%s\n' "$subjects" | grep -Eiq '^feat(\([^)]*\))?: '; then
        printf '%s\n' minor
    elif printf '%s\n' "$subjects" | grep -Eiq '^fix(\([^)]*\))?: '; then
        printf '%s\n' patch
    else
        return 1
    fi
}

release_version_from_tag() {
    local tag=$1
    local prefix=$2
    [[ "$tag" == "$prefix"* ]] || return 1
    [[ -n "$prefix" || "$tag" != v* ]] || return 1
    release_normalize_version "${tag#"$prefix"}"
}

release_latest_stable_tag() {
    local prefix=$1
    local tag version
    while IFS= read -r tag; do
        version=$(release_version_from_tag "$tag" "$prefix" 2>/dev/null) || continue
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
        printf '%s\n' "$tag"
        return 0
    done < <(git tag --list --sort=-version:refname)
    return 1
}

release_latest_prerelease_tag() {
    local prefix=$1
    local tag version
    while IFS= read -r tag; do
        version=$(release_version_from_tag "$tag" "$prefix" 2>/dev/null) || continue
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]] || continue
        printf '%s\n' "$tag"
        return 0
    done < <(git tag --list --sort=-version:refname)
    return 1
}

release_moving_tags() {
    local version=$1
    local prefix=$2
    local levels=${3//,/ }
    local major minor level

    for level in $levels; do
        case "$level" in
            major|minor|none) ;;
            *) return 1 ;;
        esac
    done

    [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 0
    major=${BASH_REMATCH[1]}
    minor=${BASH_REMATCH[2]}

    for level in $levels; do
        case "$level" in
            major) printf '%s%s\n' "$prefix" "$major" ;;
            minor) printf '%s%s.%s\n' "$prefix" "$major" "$minor" ;;
            none) ;;
        esac
    done
}
