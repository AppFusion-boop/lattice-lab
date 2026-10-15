"""Custom exceptions for the expression compiler and evaluator."""


class ExpressionError(Exception):
    """Base class for all expression errors."""


class ExpressionParseError(ExpressionError):
    """Raised when an expression has invalid syntax or unexpected tokens."""


class UnknownVariableError(ExpressionError):
    """Raised when an identifier is not in the allowed variable list."""


class MissingVariableError(ExpressionError):
    """Raised in strict mode when a variable has no provided value."""


class UnknownFunctionError(ExpressionError):
    """Raised when a function name is not recognized."""


class ArityError(ExpressionError):
    """Raised when a function is called with the wrong number of arguments."""


class NonFiniteError(ExpressionError):
    """Raised when an expression produces NaN, Infinity, or out-of-domain evaluation."""


class TooDeepError(ExpressionParseError):
    """Raised when expression nesting exceeds the maximum depth limit."""


class TooLongError(ExpressionParseError):
    """Raised when expression length exceeds the maximum character limit."""
