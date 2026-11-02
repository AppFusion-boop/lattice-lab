"""Data models for scientific research paper generation (PE-1)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AuthorMeta(BaseModel):
    name: str = Field(..., description="Full author name, e.g. 'Jane Doe'")
    affiliation: str = Field(default="", description="Institution, university, or lab department")
    email: str = Field(default="", description="Contact email address")
    orcid: str = Field(default="", description="ORCID identifier (e.g. 0000-0002-1825-0097)")
    is_corresponding: bool = Field(default=False, description="Whether this is the corresponding author")


class PaperCustomizationRequest(BaseModel):
    title: str | None = Field(default=None, description="Custom paper title")
    authors: list[AuthorMeta] = Field(default_factory=list, description="Author list with affiliations")
    template: Literal["standard", "revtex", "nature", "ieee"] = Field(
        default="standard", description="Target journal LaTeX template class"
    )
    column_layout: Literal["onecolumn", "twocolumn"] = Field(
        default="twocolumn", description="Document column layout"
    )
    include_figures: bool = Field(default=True, description="Whether to compile and embed vector figures")
    include_supplementary: bool = Field(
        default=True, description="Whether to include run sheet and audit appendices"
    )
    abstract_override: str | None = Field(default=None, description="Optional user-edited abstract text")
    section_overrides: dict[str, str] = Field(
        default_factory=dict,
        description="Optional custom text per section ID (e.g. {'intro': '...', 'discussion': '...'})",
    )


class PaperSection(BaseModel):
    id: str = Field(..., description="Machine-readable section id (e.g. 'introduction')")
    number: str = Field(..., description="Section number string (e.g. '1', '2.1')")
    title: str = Field(..., description="Section title")
    content_markdown: str = Field(..., description="Formatted markdown content with math blocks")
    content_latex: str = Field(..., description="Escaped and formatted LaTeX content")


class FigureMeta(BaseModel):
    id: str = Field(..., description="Figure identifier (e.g. 'fig_funnel')")
    title: str = Field(..., description="Figure short title")
    caption: str = Field(..., description="Full scientific caption with error bounds and methodology")
    filename_base: str = Field(..., description="Base filename without extension (e.g. 'fig1_funnel')")


class TableMeta(BaseModel):
    id: str = Field(..., description="Table identifier (e.g. 'tab_parameters')")
    title: str = Field(..., description="Table title")
    caption: str = Field(..., description="Table description and unit notes")
    filename_base: str = Field(..., description="Base filename without extension (e.g. 'tab1_parameters')")


class PaperResponse(BaseModel):
    study_id: str
    title: str
    authors: list[AuthorMeta]
    abstract: str
    keywords: list[str]
    template: str
    column_layout: str
    sections: list[PaperSection]
    figures: list[FigureMeta]
    tables: list[TableMeta]
    bibtex: str
    markdown: str
    latex: str
    generated_at: str
    master_seed: int
    evidence_fingerprint: str
