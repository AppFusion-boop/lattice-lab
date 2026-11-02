"""BibTeX bibliography generator from study sources records (PE-1)."""

from __future__ import annotations

import re

from lattice_server.schemas import SourceResponse


def sanitize_latex_text(text: str) -> str:
    """Escapes common special LaTeX characters in plain text fields."""
    if not text:
        return ""
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("&", r"\&"),
        ("%", r"\%"),
        ("$", r"\$"),
        ("#", r"\#"),
        ("_", r"\_"),
        ("{", r"\{"),
        ("}", r"\}"),
        ("~", r"\textasciitilde{}"),
        ("^", r"\textasciicircum{}"),
    ]
    res = text
    for char, rep in replacements:
        res = res.replace(char, rep)
    return res


def extract_author_and_year(citation: str) -> tuple[str, str]:
    """Attempt to extract primary author surname and 4-digit year from citation string."""
    year_match = re.search(r"\b(19\d\d|20\d\d)\b", citation)
    year = year_match.group(1) if year_match else "2024"

    # Match first author surname before comma, et al., or parenthesis
    author_match = re.match(r"^\s*([A-Za-z\-]+)", citation)
    author = author_match.group(1).capitalize() if author_match else "Ref"
    if author.lower() in ("a", "an", "the", "in", "on", "dataset", "source"):
        author = "Ref"

    return author, year


def format_source_to_bibtex(
    source: SourceResponse, idx: int
) -> tuple[str, str]:
    """Formats a single SourceResponse into a BibTeX entry and returns (entry_str, cite_key)."""
    citation_text = (source.citation or "").strip()
    author, year = extract_author_and_year(citation_text)

    # Clean cite key: e.g. "Smith2024" or "Ref2024a"
    clean_author = re.sub(r"[^A-Za-z0-9]", "", author) or "Source"
    cite_key = f"{clean_author}{year}_{source.id[:6]}"

    entry_type = "article" if source.kind in ("literature", "paper") else "misc"

    lines = [f"@{entry_type}{{{cite_key},"]

    title = citation_text if citation_text else f"Experimental Reference Data {source.id[:8]}"
    lines.append(f"  title = {{{{{title}}}}},")
    lines.append(f"  author = {{{author} and others}},")
    lines.append(f"  year = {{{year}}},")

    if source.doi:
        lines.append(f"  doi = {{{source.doi}}},")
    if source.url:
        lines.append(f"  url = {{{source.url}}},")
    if source.file_name:
        lines.append(f"  note = {{Dataset file: {source.file_name}}},")
    elif source.notes:
        lines.append(f"  note = {{{sanitize_latex_text(source.notes)}}},")

    lines.append("}")
    return "\n".join(lines), cite_key


def generate_bibtex(
    sources: list[SourceResponse], study_name: str, study_id: str
) -> tuple[str, dict[str, str]]:
    """Generates complete BibTeX bibliography and returns (bibtex_content, source_id_to_key_map)."""
    entries: list[str] = []
    source_map: dict[str, str] = {}

    # Lattice Lab software citation header
    lab_entry = f"""@software{{lattice_lab_study_{study_id[:8]},
  title = {{{{{sanitize_latex_text(study_name)}: Computational Screening Protocol and Experimental Model}}}},
  author = {{{{Lattice Lab Research Platform}}}},
  year = {{2026}},
  url = {{http://127.0.0.1:8765/api/v1/studies/{study_id}/paper}},
  note = {{Deterministic Study ID: {study_id}}}
}}"""
    entries.append(lab_entry)
    source_map["study_system"] = f"lattice_lab_study_{study_id[:8]}"

    # Process all sources from database
    for idx, s in enumerate(sources, 1):
        bib_entry, key = format_source_to_bibtex(s, idx)
        entries.append(bib_entry)
        source_map[s.id] = key

    # Foundational references in computational screening and dimensional analysis
    buckingham_entry = """@article{buckingham1914physically,
  title = {{On Physically Similar Systems; Illustrations of the Use of Dimensional Equations}},
  author = {Buckingham, Edgar},
  journal = {Physical Review},
  volume = {4},
  number = {4},
  pages = {345--376},
  year = {1914},
  doi = {10.1103/PhysRev.4.345}
}"""
    entries.append(buckingham_entry)
    source_map["buckingham1914"] = "buckingham1914physically"

    conformal_entry = """@article{vovk2005algorithmic,
  title = {{Algorithmic Learning in a Random World}},
  author = {Vovk, Vladimir and Gammerman, Alex and Shafer, Glenn},
  journal = {Springer Science \\& Business Media},
  year = {2005},
  doi = {10.1007/b106715}
}"""
    entries.append(conformal_entry)
    source_map["vovk2005"] = "vovk2005algorithmic"

    sobol_entry = """@article{sobol2001global,
  title = {{Global sensitivity indices for nonlinear mathematical models and their Monte Carlo estimates}},
  author = {Sobol, Ilya M.},
  journal = {Mathematics and Computers in Simulation},
  volume = {55},
  number = {1-3},
  pages = {271--280},
  year = {2001},
  doi = {10.1016/S0378-4754(00)00270-6}
}"""
    entries.append(sobol_entry)
    source_map["sobol2001"] = "sobol2001global"

    return "\n\n".join(entries), source_map
